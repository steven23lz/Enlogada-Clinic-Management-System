const test = require('node:test');
const assert = require('node:assert/strict');
const { normalisePatientFields } = require('../../src/validations/patientFields');

/** What a patient record may say. [1.124.0] Each refusal is one a probe got past the API. */
const TODAY = '2026-10-16';
const ok = { firstName: ' Maria ', lastName: 'Santos', birthdate: '1980-04-04', sex: 'Female', contactNumber: '0917 123 4567' };

test('a real record passes, trimmed', () => {
  const out = normalisePatientFields(ok, TODAY);
  assert.equal(out.firstName, 'Maria');
  assert.equal(out.contactNumber, '0917 123 4567');
});

test('a birthdate that cannot be true is refused', () => {
  for (const birthdate of ['2026-11-01', '1800-01-01', '2020-02-30', 'yesterday']) {
    assert.throws(() => normalisePatientFields({ ...ok, birthdate }, TODAY), { statusCode: 400 }, birthdate);
  }
  assert.equal(normalisePatientFields({ ...ok, birthdate: TODAY }, TODAY).birthdate, TODAY, 'a newborn is fine');
});

test('a blank or overlong name, an unknown sex and a phone in words are refused', () => {
  for (const bad of [{ firstName: '   ' }, { lastName: 'A'.repeat(101) }, { firstName: {} }, { sex: 'Robot' }, { contactNumber: 'call me maybe' }]) {
    assert.throws(() => normalisePatientFields({ ...ok, ...bad }, TODAY), { statusCode: 400 }, JSON.stringify(bad).slice(0, 40));
  }
});

test('a name is letters, in any language, with what real names use', () => {
  for (const firstName of ['12345', '<script>alert(1)</script>', '😀😀', '---', '...']) {
    assert.throws(() => normalisePatientFields({ ...ok, firstName }, TODAY), { statusCode: 400 }, firstName);
  }
  for (const firstName of ['Ma. Teresa', "O'Brien", 'Niño', 'Dela Cruz-Reyes', 'Juan III', 'José (Jojo)', 'A']) {
    assert.equal(normalisePatientFields({ ...ok, firstName }, TODAY).firstName, firstName);
  }
});

test('a phone number has seven digits in it, not seven characters', () => {
  for (const contactNumber of ['-------', '(((((((', '123-456']) {
    assert.throws(() => normalisePatientFields({ ...ok, contactNumber }, TODAY), { statusCode: 400 }, contactNumber);
  }
  assert.equal(normalisePatientFields({ ...ok, contactNumber: '(088) 123-4567' }, TODAY).contactNumber, '(088) 123-4567');
});

test('a field left out stays left out', () => {
  assert.deepEqual(normalisePatientFields({ address: 'Bugo' }, TODAY), { address: 'Bugo' });
});
