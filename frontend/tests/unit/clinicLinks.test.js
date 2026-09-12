import { describe, it, expect } from 'vitest';
import { httpsUrl, displayUrl, CLINIC_DEFAULTS } from '../../src/lib/clinic';

// The public site links to the clinic's Facebook page, and that address is operator-configurable
// (CLINIC_FACEBOOK in backend/.env). httpsUrl is the only thing standing between a value typed
// into a config file and an href on every public page, so what it refuses matters more than what
// it accepts. [1.72.0]

describe('httpsUrl', () => {
  it('passes an https address through, trimmed', () => {
    expect(httpsUrl('  https://www.facebook.com/enlogadaclinic  ')).toBe('https://www.facebook.com/enlogadaclinic');
  });

  it('accepts the built-in Facebook page', () => {
    expect(httpsUrl(CLINIC_DEFAULTS.facebook)).toBe('https://www.facebook.com/enlogadaclinic');
  });

  it('refuses anything that is not an https web address', () => {
    const refused = [
      'javascript:alert(1)', // would run script from the footer
      'data:text/html,hello', // would render a page of the attacker's choosing
      'http://www.facebook.com/enlogadaclinic', // not https
      'www.facebook.com/enlogadaclinic', // no scheme: a relative link into this site
      'https://', // nothing after the scheme
      'https://face book.com', // a space is a typo, not an address
      'https://x.com/"onmouseover="', // a quote would break out of the attribute
      '',
      '   ',
      null,
      undefined,
    ];
    for (const value of refused) {
      expect(httpsUrl(value), String(value)).toBe('');
    }
  });
});

describe('displayUrl', () => {
  it('shows an address the way a person would say it', () => {
    expect(displayUrl('https://www.facebook.com/enlogadaclinic/')).toBe('facebook.com/enlogadaclinic');
    expect(displayUrl('http://facebook.com/enlogadaclinic')).toBe('facebook.com/enlogadaclinic');
  });

  it('returns an empty string for nothing', () => {
    expect(displayUrl('')).toBe('');
    expect(displayUrl(undefined)).toBe('');
  });
});
