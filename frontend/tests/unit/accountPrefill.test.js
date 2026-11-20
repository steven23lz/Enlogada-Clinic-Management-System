import { describe, it, expect } from 'vitest';
import { accountPrefill } from '../../src/hooks/usePatientProfiles';

/**
 * The first profile starts from what the account already holds. [1.173.0] Sign-up asked for a
 * name and a number, and the first profile asked for them again.
 */
describe('accountPrefill', () => {
  it('fills the name and number from sign-up', () => {
    expect(accountPrefill({ firstName: ' Ana ', lastName: 'Reyes', contactNumber: '09171234567' }))
      .toEqual({ firstName: 'Ana', lastName: 'Reyes', contactNumber: '09171234567' });
  });

  it("uses a Google account's name, and fills no number it never gave", () => {
    expect(accountPrefill({ firstName: 'Ana', lastName: 'Reyes', contactNumber: null }))
      .toEqual({ firstName: 'Ana', lastName: 'Reyes', contactNumber: '' });
  });

  it("never fills Google's stand-in for an account with no name", () => {
    expect(accountPrefill({ firstName: 'Google', lastName: 'User', contactNumber: '' })).toBeNull();
    expect(accountPrefill({ firstName: 'Google', lastName: 'User', contactNumber: '0917' }))
      .toEqual({ firstName: '', lastName: '', contactNumber: '0917' });
  });

  it('fills nothing without an account', () => {
    expect(accountPrefill(null)).toBeNull();
    expect(accountPrefill({})).toBeNull();
  });
});
