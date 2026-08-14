// One definition of what counts as an acceptable password, shared by every path that sets one.
//
// The rule used to exist only on the two change-password handlers, checked inline as
// `newPassword.length < 8`. Registration had no check at all, so a self-registered client could
// hold a one-character password on an account that reaches real patient records — and the
// account could never be brought up to standard except by the owner choosing to change it. The
// minimum is enforced in one place now so the three paths cannot drift again.
const MIN_PASSWORD_LENGTH = 8;

/**
 * Returns an error message describing why the password is unacceptable, or null when it passes.
 * Returning the message rather than throwing lets each caller shape its own response.
 */
function validatePassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    return 'Password is required.';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

module.exports = { MIN_PASSWORD_LENGTH, validatePassword };
