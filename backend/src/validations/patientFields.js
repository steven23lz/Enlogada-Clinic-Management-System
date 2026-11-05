/**
 * What a patient record may say. [1.124.0]
 *
 * The controllers checked that the fields were PRESENT, and nothing checked what they said. A probe
 * registered a patient born next month, one born in 1800, one whose first name was three spaces
 * and one whose phone number was "call me maybe"; a 5,000-letter name and a sex of "Robot" reached
 * the database and came back as 500s. Age and sex are what a result's reference range is read
 * against, so a birthdate that cannot be true is not a cosmetic slip.
 *
 * Pure, so the rules are unit-tested; `today` is passed in for the same reason.
 */
const { ValidationError } = require('../errors');

const EARLIEST_BIRTHDATE = '1900-01-01';
const NAME_MAX = 100; // patients.first_name / last_name are VARCHAR(100)
const PHONE = /^[0-9+()\-\s]{7,20}$/;
// [1.160.0] Letters from any language, and what a real name uses: "Ma. Teresa", "O'Brien", "Dela Cruz-Reyes",
// "Juan III". A probe saved "12345" and "<script>" as first names.
const NAME_CHARS = /^[\p{L}\p{M}\d .,'’\-()]+$/u;
const NAME_LETTER = /\p{L}/u;

const isRealDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
};

/**
 * Checks and tidies the fields a request sent. A field left out is left out: an edit that omits
 * one keeps what is stored (see patientService.updatePatientProfile).
 *
 * @param {object} data   firstName, lastName, birthdate, sex, contactNumber, emergencyContact, …
 * @param {string} today  'YYYY-MM-DD', the clinic's local date
 * @returns {object} the same fields, trimmed
 */
const ADDRESS_MAX = 300;

function normalisePatientFields(data, today) {
  const out = { ...data };

  for (const [key, label] of [['firstName', 'First name'], ['lastName', 'Last name']]) {
    if (data[key] === undefined) continue;
    if (typeof data[key] !== 'string' || !data[key].trim()) throw new ValidationError(`${label} is required.`);
    const value = data[key].trim().replace(/\s+/g, ' ');
    if (value.length > NAME_MAX) throw new ValidationError(`${label} is too long (${NAME_MAX} characters at most).`);
    if (!NAME_CHARS.test(value) || !NAME_LETTER.test(value)) {
      throw new ValidationError(`${label} should be a name, in letters, like Juan or Dela Cruz.`);
    }
    out[key] = value;
  }

  if (data.birthdate !== undefined) {
    const value = String(data.birthdate).slice(0, 10);
    if (!isRealDate(value)) throw new ValidationError('Birthdate is not a real date.');
    if (value > today) throw new ValidationError('Birthdate cannot be in the future.');
    if (value < EARLIEST_BIRTHDATE) throw new ValidationError('Birthdate is too far in the past. Check the year.');
    out.birthdate = value;
  }

  if (data.sex !== undefined && data.sex !== 'Male' && data.sex !== 'Female') {
    throw new ValidationError('Sex must be Male or Female.');
  }

  if (data.contactNumber !== undefined && data.contactNumber !== null) {
    const value = String(data.contactNumber).trim();
    // [1.160.0] Seven digits, not seven characters: "-------" passed.
    if (value && (!PHONE.test(value) || value.replace(/\D/g, '').length < 7)) {
      throw new ValidationError('Contact number should be digits only, like 09171234567.');
    }
    out.contactNumber = value || null;
  }

  if (data.emergencyContact !== undefined && data.emergencyContact !== null) {
    if (String(data.emergencyContact).length > 100) throw new ValidationError('Emergency contact is too long (100 characters at most).');
  }

  // [1.151.0] The one free-text field with no limit, printed on the patient's header.
  if (data.address !== undefined && data.address !== null && String(data.address).length > ADDRESS_MAX) {
    throw new ValidationError(`Address is too long (${ADDRESS_MAX} characters at most).`);
  }

  return out;
}

module.exports = { normalisePatientFields, EARLIEST_BIRTHDATE };
