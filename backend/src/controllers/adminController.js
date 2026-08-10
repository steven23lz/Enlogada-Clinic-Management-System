const adminService = require('../services/adminService');

class AdminController {
  async getStaff(req, res, next) {
    try {
      const staff = await adminService.getStaffAccounts();
      return res.status(200).json({
        status: 'success',
        data: { staff }
      });
    } catch (err) {
      next(err);
    }
  }

  async createStaff(req, res, next) {
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

      const staffAccount = await adminService.createStaffAccount({
        firstName, lastName, email, password, contactNumber, role
      });

      return res.status(201).json({
        status: 'success',
        message: 'Staff account created successfully.',
        data: { staff: staffAccount }
      });
    } catch (err) {
      next(err);
    }
  }

  async updateStaffStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (typeof status !== 'boolean') {
        return res.status(400).json({
          status: 'error',
          message: 'A boolean status is required.'
        });
      }

      const staffAccount = await adminService.updateStaffStatus(id, status);
      return res.status(200).json({
        status: 'success',
        message: `Staff account ${status ? 'activated' : 'deactivated'}.`,
        data: { staff: staffAccount }
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AdminController();
