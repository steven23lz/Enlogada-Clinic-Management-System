const bcrypt = require('bcryptjs');
const userRepository = require('../repositories/userRepository');
const db = require('../config/database');
const auditService = require('./auditService');

// Module 12 (Admin Dashboard) manages the 5 operational staff roles only. Creating or managing
// Admin/SuperAdmin accounts is Module 13 (Super Admin Management)'s explicit responsibility —
// excluding them here prevents privilege escalation via this endpoint.
const MANAGEABLE_ROLES = ['Receptionist', 'Cashier', 'Laboratory Staff', 'Ultrasound Staff', 'Xray Staff'];

/**
 * Whether an Admin may manage this account.
 *
 * Asks whether EVERY role the target holds is operational — not whether *some* role is. The
 * original test was `.some()`, which passes an account holding both Receptionist and SuperAdmin
 * because it holds at least one manageable role. An Admin, who is explicitly barred from
 * /api/superadmin/*, could then call PATCH /api/admin/staff/:id/password against that account,
 * set a password they know, sign in as it, and inherit SuperAdmin — defeating the Module 12 /
 * Module 13 separation this file exists to enforce.
 *
 * Scoping this honestly: neither account-creation endpoint assigns more than one role, so the API
 * cannot produce such an account today and this is not currently exploitable. It becomes
 * exploitable with the first hand-inserted user_roles row — which is exactly what TEST_ACCOUNTS.md
 * tells operators to do to recreate the combined-role account.
 *
 * The empty-list check matters too: a roleless account must not be manageable by default.
 */
const isAdminManageable = (user) => {
  const roles = user.roles || [];
  return roles.length > 0 && roles.every((r) => MANAGEABLE_ROLES.includes(r));
};

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

    // Hashing stays outside the transaction — ~100ms of CPU should not hold a pooled connection.
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Account and role are created together. Previously the unseeded-role check threw *after* the
    // user row was already committed, so the very error meant to prevent a bad account was what
    // created one: a staff member with working credentials and no role, who logs in to an empty
    // console. Inside a transaction the same check now rolls the account back.
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

  async resetStaffPassword(userId, newPassword, requestingUser) {
    const user = await userRepository.findById(userId);
    if (!user) {
      const error = new Error('Staff account not found');
      error.statusCode = 404;
      throw error;
    }

    const isManageableStaff = isAdminManageable(user);
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

  // UI/UX Modernization Phase 11: previously only status-toggle and password-reset existed —
  // there was no way to fix a staff member's own typo'd name/email/contact number after account
  // creation short of deactivating and recreating the whole account. Role is intentionally not a
  // parameter here — reassigning a role is a separate, more sensitive action.
  async updateStaffDetails(userId, { firstName, lastName, email, contactNumber }, requestingUser) {
    const user = await userRepository.findById(userId);
    if (!user) {
      const error = new Error('Staff account not found');
      error.statusCode = 404;
      throw error;
    }

    const isManageableStaff = isAdminManageable(user);
    if (!isManageableStaff) {
      const error = new Error('This account is not a staff account managed by this endpoint.');
      error.statusCode = 403;
      throw error;
    }

    if (email !== user.email) {
      const existing = await userRepository.findByEmail(email);
      if (existing && existing.id !== Number(userId)) {
        const error = new Error('Email is already registered to another account.');
        error.statusCode = 400;
        throw error;
      }
    }

    const updated = await userRepository.updateStaffDetails(userId, { firstName, lastName, email, contactNumber });

    await auditService.log({
      actorId: requestingUser?.userId,
      action: 'staff.details_updated',
      entityType: 'user',
      entityId: userId,
      description: `Updated contact details for ${updated.first_name} ${updated.last_name} (${updated.email})`
    });

    return updated;
  }

  async updateStaffStatus(userId, status, requestingUser) {
    const user = await userRepository.findById(userId);
    if (!user) {
      const error = new Error('Staff account not found');
      error.statusCode = 404;
      throw error;
    }

    const isManageableStaff = isAdminManageable(user);
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
