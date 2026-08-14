const jwt = require('jsonwebtoken');
const env = require('../config/environment');
const userRepository = require('../repositories/userRepository');

/**
 * Establishes WHO is calling, then asks the database WHAT they may do.
 *
 * The token used to carry roles and permissions, and every authorizeRoles check downstream read
 * them straight off it. That made a signed token an authorization snapshot frozen at sign-in,
 * with two consequences that are really the same bug seen from either side:
 *
 *   - Granting a role did nothing until the user signed out and back in. An administrator would
 *     hand someone access, watch them fail to get it, and have no idea why.
 *   - Revoking a role changed nothing at all. The removed access kept working until the token
 *     expired — up to a full day. Deactivating an account did not lock anyone out either.
 *
 * The second is the serious one. "Remove this person's access" has to mean it, immediately;
 * anything else is a promise the system does not keep. So the token now proves identity only,
 * and authority is read from user_roles on every request. Grants and revocations both take
 * effect on the caller's next request, with no sign-out involved and nothing for the client to
 * cooperate with — the browser cannot hold on to access by holding on to an old token.
 *
 * Cost is one indexed lookup per authenticated request (idx_user_roles_user, idx_user_roles_role,
 * idx_role_permissions_role, added in [1.11.0]). That is the right trade for authorization: a
 * cache here would reintroduce exactly the staleness window this removes, just shorter.
 */
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      status: 'error',
      message: 'Access denied. No token provided.'
    });
  }

  const token = authHeader.split(' ')[1];
  let decoded;
  try {
    // Pin the algorithm explicitly. jsonwebtoken@9 already refuses `alg: none` and, with a string
    // secret, restricts itself to HMAC — so this is not exploitable today. But that protection is
    // a library default rather than a property of this code, and it would disappear silently the
    // day the secret became a PEM or key object for asymmetric signing, reopening the classic
    // RS256→HS256 confusion. Stating the intent costs nothing.
    decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({
      status: 'error',
      message: 'Invalid or expired token.'
    });
  }

  try {
    const user = await userRepository.findById(decoded.userId);

    // Deleted since the token was issued.
    if (!user) {
      return res.status(401).json({
        status: 'error',
        message: 'Account no longer exists. Please sign in again.'
      });
    }

    // Deactivated since the token was issued. Previously this was only checked at login, so a
    // deactivated member of staff kept full access until their token ran out.
    if (user.status === false) {
      return res.status(403).json({
        status: 'error',
        message: 'This account has been deactivated.'
      });
    }

    // Issued before the password last changed, so this session predates a credential change and
    // must not survive it.
    //
    // "Reset the password" is the standard response to a stolen token, and until this check it
    // did nothing to the attacker: the token is held in localStorage, there is no server-side
    // logout, and verifyToken looked only at the signature, the account's existence and its
    // status. A lifted token kept full access to patient records until it expired on its own.
    //
    // The one-second slack is for units, not leniency: `iat` is whole seconds while
    // password_changed_at has milliseconds, so a token minted in the same second as the change
    // can appear up to 999ms older than it is — without slack, changing your own password would
    // reject the replacement token issued moments later.
    if (user.password_changed_at) {
      const issuedAtMs = (decoded.iat || 0) * 1000;
      const changedAtMs = new Date(user.password_changed_at).getTime();
      if (issuedAtMs < changedAtMs - 1000) {
        return res.status(401).json({
          status: 'error',
          message: 'Your password was changed. Please sign in again.'
        });
      }
    }

    // Identity from the token; authority from the database, every time.
    req.user = {
      ...decoded,
      userId: user.id,
      email: user.email,
      roles: user.roles || [],
      permissions: user.permissions || []
    };
    return next();
  } catch (err) {
    return next(err);
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
//
// 2026-08-14 — interim decision: keep the middleware, and stop the UI implying it works.
// The Role-Permission Matrix now carries an "advisory only, not yet enforced" notice
// (frontend/src/pages/admin/SuperAdminManagement.jsx), because the screen let a SuperAdmin
// revoke e.g. billing:process from Cashier, watch it save, and reasonably conclude access had
// been removed while cashiers kept taking payments. A screen that lies about access is worse
// than no screen.
//
// Completing the taxonomy was deliberately NOT attempted in that pass: it means mapping 83
// routes onto a 13-permission vocabulary, and the E2E suite was cut to 5 specs the same day,
// so the safety net for a sweeping authorization change is far thinner than it looks. When it
// is picked up, the existing authorizeRoles list on each route is the ground truth for who
// should hold the derived permission — derive from those rather than inventing a new model,
// grant the full set before enforcing any of it, and grow test coverage first.
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
