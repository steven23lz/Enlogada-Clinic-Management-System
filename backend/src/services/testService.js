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
   * Validating every id up front means a bad id costs nothing: the batch rolls back and the retry
   * is clean.
   *
   * No transaction and no ownership check of its own — both belong to the caller, because the two
   * callers need different ones. `addTestsToVisit` below wraps it for Reception's walk-in flow;
   * `appointmentService.createAppointment` calls it inside the transaction that is also minting
   * the visit.
   *
   * It must NOT call assertClientOwnsVisit. Under the booking transaction that helper would be
   * reading a `patient_visits` row the transaction has not committed — which used to mean a
   * different pooled connection and a guaranteed 404, and even now that every query joins the
   * ambient transaction it is redundant: appointmentService asserts ownership on the patient
   * before it opens the transaction, and then mints the visit itself.
   */
  async attachTests(patientVisitId, testIds) {
    // Normalised to numbers up front: JSON callers send numbers, multipart sends strings, and the
    // catalogue Map below is keyed on the integer id Postgres returns. A string id would miss
    // every lookup and report a perfectly real test as "not found".
    const uniqueIds = [...new Set((testIds || []).map((id) => parseInt(id, 10)))];
    if (uniqueIds.length === 0) return [];

    // One query for every price instead of one per test — this is the receptionist's hot path,
    // and a six-test workup was twelve round trips. It also matters inside the booking
    // transaction, where the per-id loop held the slot's advisory lock for its whole duration.
    const catalogue = await testRepository.findTestsByIds(uniqueIds);
    const byId = new Map(catalogue.map((t) => [t.id, t]));

    // Every id checked before anything is written, and all of them reported at once — the old
    // loop named only the first bad id, so a receptionist fixed them one round trip at a time.
    const missing = uniqueIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      const error = new Error(
        `Test${missing.length > 1 ? 's' : ''} with ID ${missing.join(', ')} not found`
      );
      error.statusCode = 404;
      throw error;
    }

    for (const testId of uniqueIds) {
      await testRepository.addTestToVisit({
        patientVisitId,
        testId,
        priceAtTime: byId.get(testId).price
      });
    }

    // Re-read rather than collecting the inserts: addTestToVisit is ON CONFLICT DO NOTHING, so a
    // row that already existed returns undefined. Reading back gives the caller the true set.
    return await testRepository.findTestsByVisitId(patientVisitId);
  }

  async addTestsToVisit(patientVisitId, testIds, requestingUser) {
    await assertClientOwnsVisit(requestingUser, patientVisitId);

    // Standalone callers (Reception's walk-in flow) get their own transaction. Previously this
    // looped bare db.query calls, so a failure partway through left a half-attached visit.
    return await db.withTransaction(() => this.attachTests(patientVisitId, testIds));
  }

  async getVisitTests(patientVisitId) {
    return await testRepository.findTestsByVisitId(patientVisitId);
  }

  async updateVisitTestStatus(visitTestId, status) {
    return await testRepository.updateVisitTestStatus(visitTestId, status);
  }
}

module.exports = new TestService();
