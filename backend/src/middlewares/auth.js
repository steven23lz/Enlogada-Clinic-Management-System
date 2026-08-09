const jwt = require('jsonwebtoken');
const env = require('../config/environment');

const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      status: 'error',
      message: 'Access denied. No token provided.'
    });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      status: 'error',
      message: 'Invalid or expired token.'
    });
  }
};

const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.roles) {
      return res.status(403).json({
        status: 'error',
        message: 'Access forbidden. Insufficient permissions.'
      });
    }

    const hasRole = req.user.roles.some((role) => allowedRoles.includes(role));
    if (!hasRole) {
      return res.status(403).json({
        status: 'error',
        message: 'Access forbidden. Insufficient permissions.'
      });
    }

    next();
  };
};

// Decision (2026-08-10 remediation pass): NOT currently wired onto any route. Reasons:
// 1. SuperAdmin/Admin bypass below means this middleware can never additionally restrict
//    those two roles beyond what authorizeRoles already does — its only theoretical value
//    is for the 6 non-admin roles.
// 2. Permissions are granted per-role only (role_permissions), with no per-user override in
//    the data model, so for those 6 roles a permission check and a role check resolve
//    identically in every case already covered by authorizeRoles — wiring both is redundant.
// 3. The seeded permission taxonomy (setupRbac.js) is incomplete relative to the real route
//    surface: e.g. Receptionist legitimately calls POST /tests/visit-tests today, but no
//    tests:*-family permission is granted to Receptionist — wiring enforcement now would
//    break that working flow, not just add security.
// Future direction (needs Security Engineer + Project Architect sign-off, not a silent
// change): either complete the permission taxonomy and make authorizePermissions the
// primary authorization layer, or formally retire it and keep the RBAC matrix UI as
// informational/future-proofing only. Do not wire this onto routes ad hoc.
const authorizePermissions = (...requiredPermissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(403).json({
        status: 'error',
        message: 'Access forbidden.'
      });
    }

    // SuperAdmin or Admin bypass permission checks
    if (req.user.roles && (req.user.roles.includes('SuperAdmin') || req.user.roles.includes('Admin'))) {
      return next();
    }

    const userPermissions = req.user.permissions || [];
    const hasPermission = requiredPermissions.every((perm) => userPermissions.includes(perm));

    if (!hasPermission) {
      return res.status(403).json({
        status: 'error',
        message: `Access forbidden. Required permissions: ${requiredPermissions.join(', ')}`
      });
    }

    next();
  };
};

module.exports = {
  verifyToken,
  authorizeRoles,
  authorizePermissions
};
