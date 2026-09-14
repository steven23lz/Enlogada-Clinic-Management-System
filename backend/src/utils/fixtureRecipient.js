/**
 * Whether an address belongs to one of this codebase's own fixtures, where nobody can receive
 * mail. [1.86.0] config/email.js skips a send to one rather than attempting it; see there for why.
 *
 *   @enlogada-e2e.test   every throwaway account the E2E suite registers. `.test` is a reserved
 *                        name (RFC 2606), so it can never exist.
 *   @enlogada.com        the seeded demo accounts (seedUsers.js, TEST_ACCOUNTS.md). This domain
 *                        does not exist either: it had no DNS record of any kind on 2026-09-15.
 *
 * By domain rather than by a list of the seeded addresses, so an account added to the seed later
 * is covered without anyone remembering this file. If the clinic ever registers enlogada.com, the
 * seeded accounts become real addresses with a published password, and both must change together.
 *
 * One address, which is what every caller passes. A string holding several is never treated as a
 * fixture, so a real recipient in a list is never dropped along with a fake one.
 */
const FIXTURE_DOMAINS = ['@enlogada-e2e.test', '@enlogada.com'];

/** The bare address, whether written `a@b.c` or `Name <a@b.c>`, lower-cased. */
function bareAddress(to) {
  const text = to.trim();
  const angled = text.match(/<([^<>]+)>$/);
  return (angled ? angled[1] : text).trim().toLowerCase();
}

function isFixtureRecipient(to) {
  if (typeof to !== 'string' || to.trim() === '' || /[,;]/.test(to)) return false;
  const address = bareAddress(to);
  return FIXTURE_DOMAINS.some((domain) => address.endsWith(domain));
}

module.exports = { FIXTURE_DOMAINS, isFixtureRecipient };
