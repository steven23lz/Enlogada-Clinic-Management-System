const jwt = require('jsonwebtoken');
const env = require('../config/environment');
const userRepository = require('../repositories/userRepository');
const { departmentsForUser } = require('../constants/modality');

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
    //
    // `permissions` is already the effective set — role template plus this account's own grants,
    // minus its revokes — resolved in userRepository so every caller gets the same answer.
    // `departments` is the modality axis: which rooms' data this account may touch. `null` means
    // unrestricted (Admin/SuperAdmin), which is deliberately distinct from `[]`, "none".
    req.user = {
      ...decoded,
      userId: user.id,
      email: user.email,
      roles: user.roles || [],
      permissions: user.permissions || [],
      departments: departmentsForUser(user)
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

/**
 * "Is this a member of staff, of any kind?" — the structural boundary, and now the only one on a
 * departmental route. [1.20.0]
 *
 * Those routes used to name their roles: authorizeRoles('SuperAdmin', 'Cashier') on POST
 * /payments, and the three modality roles on every result route. That made the Role-Permission
 * Matrix a liar. A SuperAdmin could tick `billing:process` for Laboratory Staff, watch it save,
 * and get nothing: the nav item stayed hidden and this gate refused the request, because the lab
 * role was not in the hardcoded list. Somebody had granted access, believed it, and stopped
 * thinking about it — which is the worst failure mode an access control can have.
 *
 * The list is therefore gone and `authorizePermissions` alone decides, which is what the matrix
 * was always supposed to mean. What stays is the line a tick must never cross: a patient account
 * is a different kind of thing from a staff account, and no permission puts one on a worklist or
 * a billing queue.
 *
 * Deliberately "holds any non-Client role" rather than an allow-list of staff role names, so
 * adding an ECG Staff role later needs no edit here. A user holding Client *and* a staff role
 * (the multirole test account) is staff.
 *
 * Note this does NOT decide *whose* data they may touch. That is the department axis, enforced in
 * the service layer against req.user.departments — see resultService.assertStaffAllowedCategory.
 */
const authorizeStaff = (req, res, next) => {
  const roles = req.user?.roles || [];
  const isStaff = roles.some((role) => role !== 'Client');

  if (!isStaff) {
    return res.status(403).json({
      status: 'error',
      message: 'Access forbidden. Staff access is required for this action.'
    });
  }

  return next();
};

/**
 * Gates a route on fine-grained permissions from the role-permission matrix.
 *
 * ENFORCED as of 2026-08-16. The long-standing note here said this was advisory only, and set out
 * four preconditions for picking it up: complete the permission taxonomy, derive each grant from
 * the `authorizeRoles` list already on the route rather than inventing a new model, grant the
 * full derived set before enforcing any of it, and grow test coverage first. All four are now
 * met — 27 permissions covering the real route surface, seeded to reproduce exactly what each
 * role could already do, behind 69 specs rather than the 5 that existed when that note was
 * written. Turning enforcement on therefore changed nothing on day one; anything that changes
 * afterwards is a decision somebody made in the matrix.
 *
 * Used ALONGSIDE authorizeRoles, not instead of it. The role gate is the coarse, structural
 * boundary that should not be editable from a screen (a Client must never reach a worklist, and
 * no permission tick should make that possible); the permission gate is the delegable layer on
 * top. Two independent checks, and a route passes only if both allow it.
 *
 * SuperAdmin bypasses. Admin no longer does — and that single line is what makes the matrix mean
 * anything. While Admin bypassed, unticking a permission for Admin saved successfully and changed
 * nothing, which is precisely the "screen that lies about access" the previous note objected to.
 * The bypass remains for SuperAdmin alone because somebody has to be able to repair a matrix that
 * has been misconfigured into locking everyone out, and that role is the one that edits it.
 */
const authorizePermissions = (...requiredPermissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(403).json({
        status: 'error',
        message: 'Access forbidden.'
      });
    }

    // SuperAdmin only. Admin deliberately does NOT bypass — see the note above.
    if (req.user.roles && req.user.roles.includes('SuperAdmin')) {
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
  authorizeStaff,
  authorizePermissions
};
