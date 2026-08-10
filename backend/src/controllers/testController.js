const testService = require('../services/testService');

class TestController {
  async getAll(req, res, next) {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      const tests = await testService.getAllTests(includeInactive);
      return res.status(200).json({
        status: 'success',
        data: { tests }
      });
    } catch (err) {
      next(err);
    }
  }

  async getById(req, res, next) {
    try {
      const { id } = req.params;
      const test = await testService.getTestById(id);
      return res.status(200).json({
        status: 'success',
        data: { test }
      });
    } catch (err) {
      next(err);
    }
  }

  async create(req, res, next) {
    try {
      const { categoryId, name, price } = req.body;

      if (!categoryId || !name || price === undefined) {
        return res.status(400).json({
          status: 'error',
          message: 'Category ID, name, and price are required.'
        });
      }

      const test = await testService.createTest({ categoryId, name, price });
      return res.status(201).json({
        status: 'success',
        message: 'Test created successfully.',
        data: { test }
      });
    } catch (err) {
      next(err);
    }
  }

  async update(req, res, next) {
    try {
      const { id } = req.params;
      const { categoryId, name, price, isActive } = req.body;

      if (!categoryId || !name || price === undefined) {
        return res.status(400).json({
          status: 'error',
          message: 'Category ID, name, and price are required.'
        });
      }

      const test = await testService.updateTest(id, {
        categoryId,
        name,
        price,
        isActive: isActive !== undefined ? isActive : true
      });
      return res.status(200).json({
        status: 'success',
        message: 'Test updated successfully.',
        data: { test }
      });
    } catch (err) {
      next(err);
    }
  }

  async updatePrice(req, res, next) {
    try {
      const { id } = req.params;
      const { price } = req.body;

      if (price === undefined || isNaN(price)) {
        return res.status(400).json({
          status: 'error',
          message: 'Price is required and must be a valid number.'
        });
      }

      const test = await testService.updateTestPrice(id, parseFloat(price));
      return res.status(200).json({
        status: 'success',
        message: 'Test price updated successfully.',
        data: { test }
      });
    } catch (err) {
      next(err);
    }
  }

  async getCategories(req, res, next) {
    try {
      const categories = await testService.getCategories();
      return res.status(200).json({
        status: 'success',
        data: { categories }
      });
    } catch (err) {
      next(err);
    }
  }

  async addTestsToVisit(req, res, next) {
    try {
      const { patientVisitId, testIds } = req.body;

      if (!patientVisitId || !testIds || !Array.isArray(testIds) || testIds.length === 0) {
        return res.status(400).json({
          status: 'error',
          message: 'Patient visit ID and an array of test IDs are required.'
        });
      }

      const visitTests = await testService.addTestsToVisit(patientVisitId, testIds, req.user);
      return res.status(201).json({
        status: 'success',
        message: `${visitTests.length} test(s) added to visit.`,
        data: { visitTests }
      });
    } catch (err) {
      next(err);
    }
  }

  async getVisitTests(req, res, next) {
    try {
      const { visitId } = req.params;
      const visitTests = await testService.getVisitTests(visitId);
      return res.status(200).json({
        status: 'success',
        data: { visitTests }
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new TestController();
