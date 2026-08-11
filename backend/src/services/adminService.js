const bcrypt = require('bcryptjs');
const userRepository = require('../repositories/userRepository');

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

  async resetStaffPassword(userId, newPassword) {
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
  }

  async updateStaffStatus(userId, status) {
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

    return await userRepository.updateUserStatus(userId, status);
  }
}

module.exports = new AdminService();
