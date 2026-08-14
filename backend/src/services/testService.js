const testRepository = require('../repositories/testRepository');
const visitRepository = require('../repositories/visitRepository');
const db = require('../config/database');
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

  /**
   * Attaches a set of tests to a visit, pricing each at the catalogue price right now.
   *
   * All-or-nothing, and it did not used to be. The loop committed each test as it went, so a bad
   * id partway through — a test deleted since the page loaded, or simply mistyped — left the
   * earlier tests attached and then threw. The receptionist sees an error and retries the whole
   * list, which now collides with uq_visit_tests_visit_test and surfaces as a bare 500. Nothing
   * in any endpoint tells them which of the tests actually landed, and getBillingSummary prices
   * strictly from visit_tests, so the patient is billed for a partial workup while the missing
   * test never reaches its modality.
   *
   * Validating every id up front, inside the transaction, means a bad id costs nothing: the batch
   * rolls back and the retry is clean.
   */
  async addTestsToVisit(patientVisitId, testIds, requestingUser) {
    await assertClientOwnsVisit(requestingUser, patientVisitId);

    return await db.withTransaction(async () => {
      // One query for every price instead of one per test — this is the receptionist's hot path,
      // and a six-test workup was twelve round trips.
      const tests = await testRepository.findTestsByIds(testIds);
      const priceById = new Map(tests.map((t) => [String(t.id), t.price]));

      const missing = testIds.filter((id) => !priceById.has(String(id)));
      if (missing.length > 0) {
        const error = new Error(
          `Test${missing.length > 1 ? 's' : ''} with ID ${missing.join(', ')} not found`
        );
        error.statusCode = 404;
        throw error;
      }

      const results = [];
      for (const testId of testIds) {
        results.push(
          await testRepository.addTestToVisit({
            patientVisitId,
            testId,
            priceAtTime: priceById.get(String(testId))
          })
        );
      }
      return results;
    });
  }

  async getVisitTests(patientVisitId) {
    return await testRepository.findTestsByVisitId(patientVisitId);
  }

  async updateVisitTestStatus(visitTestId, status) {
    return await testRepository.updateVisitTestStatus(visitTestId, status);
  }
}

module.exports = new TestService();
