/**
 * Names for test fixtures that read as people.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────
 *
 * Fixtures were named `E2E Pkg1786480428`, `Reyes-17863726459464828`, `M9 Probe1786…`. Those rows
 * are real rows in a real database while the suite runs: they sit in the Active Queue, the billing
 * queue and the patient search, and anyone who opens the app mid-run — or after a purge that did
 * not complete — sees a clinic full of garbage. A demo that happens to overlap a test run looks
 * broken, and the names are the whole reason.
 *
 * They also made the seeded demo data and the test data look like two different products.
 *
 * ── Uniqueness, which is the hard part ───────────────────────────────────────────────────────
 *
 * Specs create a patient and then find it again by name, so a fixture name has to be unique. The
 * old generators bought that with a timestamp, which is exactly what made them unreadable.
 *
 * Here the pool is large enough that collisions are rare (given × surname), and the ones that do
 * happen are caught: every name handed out is remembered for the life of the process and re-rolled
 * if it repeats. After enough attempts it falls back to a second surname — "Santos-Villanueva" —
 * which is an ordinary Filipino compound surname rather than an obvious escape hatch.
 *
 * ── What identifies a fixture, now that the name does not ────────────────────────────────────
 *
 * Nothing in the automatic teardown ever used the name: `purgeE2eData.js` scopes by the
 * `@enlogada-e2e.test` email and by the run's start timestamp, and walk-in fixtures (which have no
 * account) are caught as parentless patients created inside that window. Both are name-independent
 * and both keep working.
 *
 * `cleanE2eData.js` — the manual tool for a database that has already silted up — DOES match on
 * the old name shapes. Those patterns are kept there for the historical rows, and it gained the
 * reserved contact number below so it can still find anything created from here on.
 */

/**
 * The number every fixture carries. Reserved and obviously non-real (no Philippine mobile
 * prefix is 0900), so cleanup can identify a test patient without reading its name, and a human
 * looking at the record can tell it is not a live one.
 */
export const FIXTURE_CONTACT = '09000000000';

const GIVEN = [
  'Andres', 'Angelo', 'Antonio', 'Arturo', 'Benigno', 'Carlos', 'Cesar', 'Danilo', 'Eduardo',
  'Emilio', 'Ernesto', 'Federico', 'Fernando', 'Gregorio', 'Ignacio', 'Isagani', 'Joaquin',
  'Leandro', 'Lorenzo', 'Manolo', 'Mariano', 'Nicolas', 'Rafael', 'Ramon', 'Rodrigo', 'Teodoro',
  'Amihan', 'Angeline', 'Aurora', 'Beatriz', 'Carmela', 'Clarita', 'Corazon', 'Dalisay', 'Elena',
  'Esperanza', 'Gabriela', 'Imelda', 'Josefina', 'Leticia', 'Liwayway', 'Lualhati', 'Marisol',
  'Melchora', 'Nenita', 'Perlita', 'Remedios', 'Rosario', 'Soledad', 'Teresita', 'Trinidad',
];

const SURNAME = [
  'Abadilla', 'Agbayani', 'Alonzo', 'Amador', 'Aquino', 'Bacani', 'Balagtas', 'Bautista',
  'Bernardo', 'Cabrera', 'Cadiz', 'Carpio', 'Castillo', 'Cordero', 'Cuenca', 'Dimaano',
  'Escalona', 'Espiritu', 'Fajardo', 'Gatchalian', 'Guzman', 'Hidalgo', 'Ilagan', 'Javier',
  'Lacsamana', 'Ladrido', 'Legaspi', 'Macapagal', 'Magsaysay', 'Manalo', 'Mendiola', 'Nakpil',
  'Navarro', 'Ocampo', 'Padilla', 'Panganiban', 'Quintos', 'Rivera', 'Salcedo', 'Sarmiento',
  'Tolentino', 'Trinidad', 'Ubaldo', 'Valdez', 'Ventura', 'Villamor', 'Villanueva', 'Ylagan',
  'Zamora', 'Zulueta',
];

const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Per-process, which is per-suite-run: the runner uses a single worker, so one Set covers every
// spec in the run. Stale names from a PREVIOUS run are not a concern — the purge removes them,
// and a spec looks up the name it just created rather than scanning for a shape.
const handedOut = new Set();

/**
 * A realistic, unused name.
 *
 * Returns `{ firstName, lastName, fullName }`. Pass it straight into a patient fixture, and use
 * `lastName` where a spec needs to search for what it created.
 */
export function fixturePerson() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const firstName = pick(GIVEN);
    const lastName = pick(SURNAME);
    const key = `${firstName} ${lastName}`;
    if (!handedOut.has(key)) {
      handedOut.add(key);
      return { firstName, lastName, fullName: key };
    }
  }

  // The pool is ~2,500 combinations and a run creates a few dozen fixtures, so reaching here means
  // an unusually unlucky run rather than exhaustion. A compound surname is an ordinary Filipino
  // name, so the fallback still reads as a person.
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const firstName = pick(GIVEN);
    const lastName = `${pick(SURNAME)}-${pick(SURNAME)}`;
    const key = `${firstName} ${lastName}`;
    if (!handedOut.has(key)) {
      handedOut.add(key);
      return { firstName, lastName, fullName: key };
    }
  }

  throw new Error('fixturePerson: could not find an unused name — is the pool exhausted?');
}

/**
 * An email for a fixture that needs an account.
 *
 * The domain is what the automatic purge scopes on, so it must stay `@enlogada-e2e.test`. The
 * local part carries the timestamp — invisible on every clinic screen, which is the point: the
 * uniqueness lives where nobody has to read it.
 */
export function fixtureEmail(person) {
  const slug = `${person.firstName}.${person.lastName}`.toLowerCase().replace(/[^a-z.]/g, '');
  return `${slug}.${Date.now()}${Math.floor(Math.random() * 1000)}@enlogada-e2e.test`;
}
