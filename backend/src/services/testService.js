const testRepository = require('../repositories/testRepository');

class TestService {
  async getAllTests() {
    return await testRepository.findAllTests();
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

  async addTestsToVisit(patientVisitId, testIds) {
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
