const bcrypt = require('bcryptjs');
const userRepository = require('../repositories/userRepository');
const auditService = require('./auditService');

// Module 12 (Admin Dashboard) manages the 5 operational staff roles only. Creating or managing
// Admin/SuperAdmin accounts is Module 13 (Super Admin Management)'s explicit responsibility —
// excluding them here prevents privilege escalation via this endpoint.
const MANAGEABLE_ROLES = ['Receptionist', 'Cashier', 'Laboratory Staff', 'Ultrasound Staff', 'Xray Staff'];

class AdminService {
  async getStaffAccounts() {
    return await userRepository.findStaffUsers(MANAGEABLE_ROLES);
  }

  async createStaffAccount({ firstName, lastName, email, password, contactNumber, role }) {
    if (!MANAGEABLE_ROLES.includes(role)) {
      const error = new Error(`Invalid role. Must be one of: ${MANAGEABLE_ROLES.join(', ')}`);
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
    const user = await userRepository.createUser(firstName, lastName, email, passwordHash, contactNumber);

    const roleId = await userRepository.findRoleIdByName(role);
    if (!roleId) {
      const error = new Error(`Role "${role}" is not seeded in the database.`);
      error.statusCode = 500;
      throw error;
    }
    await userRepository.assignRoleToUser(user.id, roleId);

    return { ...user, roles: [role] };
  }

  async resetStaffPassword(userId, newPassword, requestingUser) {
    const user = await userRepository.findById(userId);
    if (!user) {
      const error = new Error('Staff account not found');
      error.statusCode = 404;
      throw error;
    }

    const isManageableStaff = (user.roles || []).some((r) => MANAGEABLE_ROLES.includes(r));
    if (!isManageableStaff) {
      const error = new Error('This account is not a staff account managed by this endpoint.');
      error.statusCode = 403;
      throw error;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);
    await userRepository.updatePasswordHash(userId, passwordHash);

    await auditService.log({
      actorId: requestingUser?.userId,
      action: 'staff.password_reset',
      entityType: 'user',
      entityId: userId,
      description: `Reset password for ${user.first_name} ${user.last_name} (${user.email})`
    });
  }

  async updateStaffStatus(userId, status, requestingUser) {
    const user = await userRepository.findById(userId);
    if (!user) {
      const error = new Error('Staff account not found');
      error.statusCode = 404;
      throw error;
    }

    const isManageableStaff = (user.roles || []).some((r) => MANAGEABLE_ROLES.includes(r));
    if (!isManageableStaff) {
      const error = new Error('This account is not a staff account managed by this endpoint.');
      error.statusCode = 403;
      throw error;
    }

    const updated = await userRepository.updateUserStatus(userId, status);

    await auditService.log({
      actorId: requestingUser?.userId,
      action: status ? 'staff.activated' : 'staff.deactivated',
      entityType: 'user',
      entityId: userId,
      description: `${status ? 'Activated' : 'Deactivated'} staff account ${user.first_name} ${user.last_name} (${user.email})`
    });

    return updated;
  }
}

module.exports = new AdminService();
