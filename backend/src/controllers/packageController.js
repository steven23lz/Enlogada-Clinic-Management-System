const packageService = require('../services/packageService');

class PackageController {
  /**
   * The clinic's package deals, with their components.
   *
   * Public and unauthenticated, exactly like `GET /tests`: the price list is the page a
   * prospective patient reads to decide whether to come at all, and a bundle they cannot see is
   * a bundle they cannot ask for.
   */
  async getAll(req, res, next) {
    try {
      const packages = await packageService.listActive();
      return res.status(200).json({
        status: 'success',
        data: { packages }
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new PackageController();
