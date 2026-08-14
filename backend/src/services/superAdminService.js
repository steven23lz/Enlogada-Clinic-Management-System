const bcrypt = require('bcryptjs');
const userRepository = require('../repositories/userRepository');
const db = require('../config/database');

// Module 13 (Super Admin Management): "elevated account management beyond what Admin can do."
// Mirrors adminService.js's staff-management pattern (Module 12), but for Admin/SuperAdmin
// roles specifically, and restricted to SuperAdmin-only authorization at the route level —
// Admin must not be able to create or manage its own or another Admin/SuperAdmin account.
const ELEVATED_ROLES = ['Admin', 'SuperAdmin'];

class SuperAdminService {
  async getElevatedAccounts() {
    return await userRepository.findStaffUsers(ELEVATED_ROLES);
  }

  async createElevatedAccount({ firstName, lastName, email, password, contactNumber, role }) {
    if (!ELEVATED_ROLES.includes(role)) {
      const error = new Error(`Invalid role. Must be one of: ${ELEVATED_ROLES.join(', ')}`);
      error.statusCode = 400;
      throw error;
    }

    const existingUser = await userRepository.findByEmail(email);
    if (existingUser) {
      const error = new Error('Email is already registered');
      error.statusCode = 400;
      throw error;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Atomic for the same reason as adminService.createStaffAccount, and it matters more here:
    // a half-created Admin or SuperAdmin is an elevated account whose privileges did not land.
    // It looks like an administrator in the user list and behaves like a locked-out one.
    const user = await db.withTransaction(async () => {
      const created = await userRepository.createUser(firstName, lastName, email, passwordHash, contactNumber);

      const roleId = await userRepository.findRoleIdByName(role);
      if (!roleId) {
        const error = new Error(`Role "${role}" is not seeded in the database.`);
        error.statusCode = 500;
        throw error;
      }
      await userRepository.assignRoleToUser(created.id, roleId);
      return created;
    });

    return { ...user, roles: [role] };
  }

  async updateElevatedAccountStatus(userId, status, requestingUserId) {
    if (parseInt(userId, 10) === requestingUserId) {
      const error = new Error('You cannot deactivate your own account — this could lock the clinic out of elevated administration entirely.');
      error.statusCode = 400;
      throw error;
    }

    const user = await userRepository.findById(userId);
    if (!user) {
      const error = new Error('Account not found');
      error.statusCode = 404;
      throw error;
    }

    const isElevated = (user.roles || []).some((r) => ELEVATED_ROLES.includes(r));
    if (!isElevated) {
      const error = new Error('This account is not an elevated (Admin/SuperAdmin) account managed by this endpoint.');
      error.statusCode = 403;
      throw error;
    }

    return await userRepository.updateUserStatus(userId, status);
  }
}

module.exports = new SuperAdminService();
