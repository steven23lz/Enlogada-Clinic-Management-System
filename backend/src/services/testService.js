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

  async addTestsToVisit(patientVisitId, testIds, requestingUser) {
    await assertClientOwnsVisit(requestingUser, patientVisitId);

    const results = [];
    for (const testId of testIds) {
      // Fetch current price to lock it at time of visit
      const test = await testRepository.findTestById(testId);
      if (!test) {
        const error = new Error(`Test with ID ${testId} not found`);
        error.statusCode = 404;
        throw error;
      }

      const visitTest = await testRepository.addTestToVisit({
        patientVisitId,
        testId,
        priceAtTime: test.price
      });
      results.push(visitTest);
    }
    return results;
  }

  async getVisitTests(patientVisitId) {
    return await testRepository.findTestsByVisitId(patientVisitId);
  }

  async updateVisitTestStatus(visitTestId, status) {
    return await testRepository.updateVisitTestStatus(visitTestId, status);
  }
}

module.exports = new TestService();
