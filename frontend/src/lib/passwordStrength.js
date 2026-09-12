/**
 * How strong a new password looks, for the meter under Create Account. [1.72.0]
 *
 * The server enforces exactly one rule, at least MIN_PASSWORD_LENGTH characters
 * (backend/src/validations/passwordPolicy.js), and this file must not invent a second. So below
 * the minimum the meter states the rule rather than a strength, and everything above it is advice:
 * longer, and a mix of lower case, upper case, digits and symbols, reads as stronger. A "Fair"
 * password is still accepted, and nothing here blocks a submit.
 */

// The server's number. tests/unit/passwordStrength.test.js reads the backend file and fails if the
// two ever disagree, so the meter cannot promise a rule the server no longer holds.
export const MIN_PASSWORD_LENGTH = 8;

const LABELS = { 2: 'Fair', 3: 'Good', 4: 'Strong' };

/**
 * @param {string} password
 * @returns {{ score: 0|1|2|3|4, label: string }}
 *   0 nothing typed · 1 under the minimum · 2 meets it · 3 long OR varied · 4 long AND varied
 */
export function passwordStrength(password = '') {
  if (!password) return { score: 0, label: `At least ${MIN_PASSWORD_LENGTH} characters` };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { score: 1, label: `Too short: at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  const long = password.length >= 12;
  const score = long && variety >= 3 ? 4 : long || variety >= 3 ? 3 : 2;
  return { score, label: LABELS[score] };
}
