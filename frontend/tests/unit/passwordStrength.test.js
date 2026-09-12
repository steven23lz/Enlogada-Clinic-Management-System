import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { passwordStrength, MIN_PASSWORD_LENGTH } from '../../src/lib/passwordStrength';

// The meter under Create Account may give advice, but the only thing it may state as a RULE is the
// one the server enforces. So these tests read the server's own policy file rather than repeating
// its number: if either side changes alone, this fails, and the meter cannot go on promising a
// rule the server no longer holds. [1.72.0]
const require = createRequire(import.meta.url);
const server = require('../../../backend/src/validations/passwordPolicy.js');

describe('passwordStrength', () => {
  it('uses the same minimum as the server', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(server.MIN_PASSWORD_LENGTH);
  });

  it('states the rule before anything is typed', () => {
    expect(passwordStrength('')).toEqual({ score: 0, label: `At least ${MIN_PASSWORD_LENGTH} characters` });
  });

  it('calls exactly what the server refuses too short, and exactly what it accepts acceptable', () => {
    const under = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);
    const at = 'a'.repeat(MIN_PASSWORD_LENGTH);

    expect(passwordStrength(under).score).toBe(1);
    expect(passwordStrength(under).label).toMatch(/too short/i);
    expect(server.validatePassword(under)).not.toBeNull();

    expect(passwordStrength(at).score).toBe(2);
    expect(server.validatePassword(at)).toBeNull();
  });

  it('treats length and variety above the minimum as advice', () => {
    expect(passwordStrength('abcdefg1')).toEqual({ score: 2, label: 'Fair' }); // two kinds
    expect(passwordStrength('Abcdefg1')).toEqual({ score: 3, label: 'Good' }); // three kinds
    expect(passwordStrength('abcdefghijkl')).toEqual({ score: 3, label: 'Good' }); // long
    expect(passwordStrength('Abcdefghij1!')).toEqual({ score: 4, label: 'Strong' }); // long and varied
  });
});
