const packageService = require('../services/packageService');

class PackageController {
  /**
   * The clinic's package deals, with their components.
   *
   * Public and unauthenticated, exactly like `GET /tests`: the price list is the page a
   * prospective patient reads to decide whether to come at all, and a bundle they cannot see is
   * a bundle they cannot ask for.
   *
   * Retired packages are NOT here — see `getAllForManagement`.
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

  /**
   * Every package, retired ones included, for the management screen.
   *
   * A separate route rather than `?includeInactive=true` on the public one. That was the first
   * shape and it could never work: the public route runs no `verifyToken`, so `req.user` is
   * undefined even when a caller sends a perfectly good token — the flag was silently always
   * false, and the management screen would have shown an incomplete list with nothing to indicate
   * why. An authorisation decision needs middleware that actually runs.
   */
  async getAllForManagement(req, res, next) {
    try {
      const packages = await packageService.listAll();
      return res.status(200).json({
        status: 'success',
        data: { packages }
      });
    } catch (err) {
      next(err);
    }
  }

  async create(req, res, next) {
    try {
      const { code, name, price, description, testIds } = req.body;

      if (!code || !name || price === undefined || !Array.isArray(testIds)) {
        return res.status(400).json({
          status: 'error',
          message: 'Code, name, price and a list of test IDs are required.'
        });
      }
      if (Number(price) < 0 || Number.isNaN(Number(price))) {
        return res.status(400).json({ status: 'error', message: 'Price must be a positive amount.' });
      }

      const pkg = await packageService.save(null, { code, name, price, description, testIds });
      return res.status(201).json({
        status: 'success',
        message: `${pkg.name} created.`,
        data: { package: pkg }
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Partial update: only what the caller sent is written.
   *
   * `undefined` means "not mentioned, leave it", which is the distinction the Services Catalogue's
   * status toggle got wrong for tests — it sent four fields and wiped each test's patient
   * preparation on every activate/deactivate. Same trap, same shape, avoided here.
   */
  async update(req, res, next) {
    try {
      const { id } = req.params;
      const { code, name, price, description, isActive, testIds } = req.body;

      if (price !== undefined && (Number(price) < 0 || Number.isNaN(Number(price)))) {
        return res.status(400).json({ status: 'error', message: 'Price must be a positive amount.' });
      }
      if (testIds !== undefined && !Array.isArray(testIds)) {
        return res.status(400).json({ status: 'error', message: 'testIds must be an array.' });
      }

      const pkg = await packageService.save(id, { code, name, price, description, isActive, testIds });
      return res.status(200).json({
        status: 'success',
        message: `${pkg.name} updated.`,
        data: { package: pkg }
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new PackageController();
