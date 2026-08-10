const superAdminService = require('../services/superAdminService');

class SuperAdminController {
  async getElevatedAccounts(req, res, next) {
    try {
      const accounts = await superAdminService.getElevatedAccounts();
      return res.status(200).json({
        status: 'success',
        data: { accounts }
      });
    } catch (err) {
      next(err);
    }
  }

  async createElevatedAccount(req, res, next) {
    try {
      const { firstName, lastName, email, password, contactNumber, role } = req.body;

      if (!firstName || !lastName || !email || !password || !role) {
        return res.status(400).json({
          status: 'error',
          message: 'First name, last name, email, password, and role are required fields.'
        });
      }

      if (password.length < 8) {
        return res.status(400).json({
          status: 'error',
          message: 'Password must be at least 8 characters.'
        });
      }

      const account = await superAdminService.createElevatedAccount({
        firstName, lastName, email, password, contactNumber, role
      });

      return res.status(201).json({
        status: 'success',
        message: 'Elevated account created successfully.',
        data: { account }
      });
    } catch (err) {
      next(err);
    }
  }

  async updateElevatedAccountStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (typeof status !== 'boolean') {
        return res.status(400).json({
          status: 'error',
          message: 'A boolean status is required.'
        });
      }

      const account = await superAdminService.updateElevatedAccountStatus(id, status, req.user.userId);
      return res.status(200).json({
        status: 'success',
        message: `Account ${status ? 'activated' : 'deactivated'}.`,
        data: { account }
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new SuperAdminController();
