const db = require('../config/database');
const testRepository = require('../repositories/testRepository');
const visitRepository = require('../repositories/visitRepository');
const patientService = require('./patientService');

// Mirrors appointmentService.js's assertClientOwnsPatient exactly. POST /tests/visit-tests
// authorizes the Client role (for self-service booking) but previously performed no ownership
// check at all — a client could attach tests to, and be billed against, any arbitrary
// patientVisitId. Known gap, deferred since the pre-implementation remediation pass; fixed here
// as part of Module 15 (visit_tests attachment is this module's own scope).
async function assertClientOwnsVisit(requestingUser, patientVisitId) {
  if (!requestingUser?.roles?.includes('Client')) return; // staff roles are not ownership-restricted
  const visit = await visitRepository.findVisitById(patientVisitId);
  if (!visit) {
    const error = new Error('Visit not found');
    error.statusCode = 404;
    throw error;
  }
  const patient = await patientService.getPatientById(visit.patient_id);
  if (patient.user_id !== requestingUser.userId) {
    const error = new Error('Access forbidden. This visit does not belong to your account.');
    error.statusCode = 403;
    throw error;
  }
}

class TestService {
  async getAllTests(includeInactive = false) {
    return await testRepository.findAllTests(includeInactive);
  }

  async getTestById(id) {
    const test = await testRepository.findTestById(id);
    if (!test) {
      const error = new Error('Test not found');
      error.statusCode = 404;
      throw error;
    }
    return test;
  }

  async createTest(testData) {
    return await testRepository.createTest(testData);
  }

  async updateTest(id, testData) {
    const existing = await testRepository.findTestById(id);
    if (!existing) {
      const error = new Error('Test not found');
      error.statusCode = 404;
      throw error;
    }
    return await testRepository.updateTest(id, testData);
  }

  async updateTestPrice(id, price) {
    const existing = await testRepository.findTestById(id);
    if (!existing) {
      const error = new Error('Test not found');
      error.statusCode = 404;
      throw error;
    }
    return await testRepository.updateTestPrice(id, price);
  }

  async getCategories() {
    return await testRepository.findAllCategories();
  }

  // Attaches tests to a visit on a caller-supplied transaction. No ownership check and no
  // connection management: both belong to the caller.
  //
  // It must NOT call assertClientOwnsVisit. That helper reads through visitRepository on the
  // default pool connection, so inside an open transaction it cannot see the uncommitted
  // patient_visits row and would throw 404 'Visit not found', rolling back every booking that
  // includes tests. appointmentService asserts ownership on the patient before it opens the
  // transaction, and mints the visit itself, so the check is redundant there anyway.
  async attachTests(patientVisitId, testIds, client) {
    const uniqueIds = [...new Set(testIds)];

    // One lookup for the whole basket. The per-id loop this replaces issued a query each, which
    // inside the booking transaction meant holding the slot's advisory lock for longer than
    // necessary -- and validated ids one at a time, so an unknown id partway through left the
    // earlier tests already attached.
    const catalogue = await testRepository.findTestsByIds(uniqueIds, client);
    const byId = new Map(catalogue.map((t) => [t.id, t]));

    for (const testId of uniqueIds) {
      if (!byId.has(testId)) {
        const error = new Error(`Test with ID ${testId} not found`);
        error.statusCode = 404;
        throw error;
      }
    }

    for (const testId of uniqueIds) {
      await testRepository.addTestToVisit({
        patientVisitId,
        testId,
        priceAtTime: byId.get(testId).price
      }, client);
    }

    // Re-read rather than collecting the inserts: addTestToVisit is ON CONFLICT DO NOTHING, so a
    // row that already existed returns undefined. Reading back gives the caller the true set.
    return await testRepository.findTestsByVisitId(patientVisitId, client);
  }

  async addTestsToVisit(patientVisitId, testIds, requestingUser) {
    await assertClientOwnsVisit(requestingUser, patientVisitId);

    // Standalone callers (Reception's walk-in flow) get their own transaction. Previously this
    // looped bare db.query calls, so a failure partway through left a half-attached visit.
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const visitTests = await this.attachTests(patientVisitId, testIds, client);
      await client.query('COMMIT');
      return visitTests;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }


  async getVisitTests(patientVisitId) {
    return await testRepository.findTestsByVisitId(patientVisitId);
  }

  async updateVisitTestStatus(visitTestId, status) {
    return await testRepository.updateVisitTestStatus(visitTestId, status);
  }
}

module.exports = new TestService();
