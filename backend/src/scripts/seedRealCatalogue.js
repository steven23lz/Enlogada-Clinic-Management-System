/**
 * Load the clinic's REAL laboratory catalogue and prices.
 *
 * Source: the clinic's printed price list (Enlogada Clinic, National Highway, Diesto Building,
 * Bugo, Cagayan de Oro City). Transcribed exactly — no price here is inferred or rounded.
 *
 * Until now the catalogue held demo values, and they were wrong in both directions: CBC was
 * priced at 350.00 against a real 180.00, while HbA1c was 750.00 against a real 1,000.00. Every
 * bill, receipt and revenue figure the system has produced was built on those numbers.
 *
 * ── What this does, and does not, touch ─────────────────────────────────────────────────────
 *
 * Existing rows are UPDATED in place, never replaced. `visit_tests.price_at_time` snapshots the
 * price at the moment of sale, so past bills keep saying what they said; only future ones change.
 * Deleting and re-inserting would break the foreign key from 54 historical visit_tests rows and
 * throw away the link between a visit and what was actually done.
 *
 * Ultrasound, X-Ray, 2D Echo and ECG are NOT touched. The price list this comes from covers
 * laboratory work only, so their prices remain the demo values they always were. They need the
 * clinic's own figures before they can be trusted — see the summary this prints.
 *
 * Dry-run by default. Pass --confirm to write.
 *   node src/scripts/seedRealCatalogue.js
 *   node src/scripts/seedRealCatalogue.js --confirm
 */
const db = require('../config/database');
const logger = require('../config/logger');

const FASTING = 'Nothing to eat or drink except water for 8 hours before the test.';

// name, price, preparation. `null` preparation means "leave whatever is already there".
// Grouped as the clinic's own sheet groups them; all are Laboratory as far as departmental
// routing is concerned, which is what test_categories drives.
const LABORATORY = [
  // --- Blood chemistry ---
  ['Fasting Blood Sugar (FBS)', 190.00, FASTING],
  ['Random Blood Sugar (RBS)', 190.00, ''],
  ['HbA1c', 1000.00, ''],
  ['Creatinine', 190.00, ''],
  ['Blood Uric Acid (BUA)', 190.00, ''],
  ['Blood Urea Nitrogen (BUN)', 250.00, ''],
  ['Lipid Profile', 760.00, FASTING],
  ['Cholesterol only', 250.00, FASTING],
  ['SGPT', 230.00, ''],
  // Fasting is not optional for a glucose tolerance test — an unfasted patient is sent home and
  // the visit is wasted. Flagged in the summary for the clinic to confirm the wording.
  ['OGTT 75g', 800.00, FASTING],

  // --- Haematology ---
  ['Complete Blood Count (CBC)', 180.00, ''],
  ['Blood Typing', 190.00, ''],
  ['Clotting Time / Bleeding Time (CT BT)', 160.00, ''],

  // --- Clinical microscopy ---
  ['Urinalysis', 90.00, ''],
  ['Stool Exam', 90.00, ''],

  // --- Serology / immunology ---
  ['Hepatitis B Screening', 190.00, ''],
  ['VDRL / Syphilis', 290.00, ''],
  ['TSH', 800.00, ''],
  ['T3', 800.00, ''],
  ['T4', 800.00, ''],
  ['FT3', 800.00, ''],
  ['FT4', 800.00, ''],
];

// Demo rows whose real-world equivalent is listed above under a different name. Renamed rather
// than duplicated, so the 54 historical visit_tests rows keep pointing at the right service.
const RENAME = {
  'Fasting Blood Sugar (FBS)': 'Fasting Blood Sugar (FBS)',
  'Complete Blood Count (CBC)': 'Complete Blood Count (CBC)',
};

async function main() {
  const confirm = process.argv.includes('--confirm');
  logger.info(`Real catalogue seed — ${confirm ? 'APPLYING' : 'DRY RUN (pass --confirm to write)'}`);

  const { rows: cats } = await db.query(`SELECT id, name FROM test_categories`);
  const labId = cats.find((c) => c.name === 'Laboratory')?.id;
  if (!labId) throw new Error('No Laboratory category found.');

  const { rows: existing } = await db.query(
    `SELECT id, name, price, preparation FROM tests WHERE category_id = $1`,
    [labId]
  );
  const byName = new Map(existing.map((t) => [t.name.toLowerCase(), t]));

  const planned = { update: [], insert: [], unchanged: [] };

  for (const [name, price, prep] of LABORATORY) {
    const found = byName.get((RENAME[name] || name).toLowerCase());
    if (!found) {
      planned.insert.push([name, price, prep]);
      continue;
    }
    const priceChanged = Number(found.price) !== price;
    const prepChanged = prep !== '' && (found.preparation || '') !== prep;
    if (priceChanged || prepChanged) {
      planned.update.push([found, name, price, prep, priceChanged]);
    } else {
      planned.unchanged.push(name);
    }
  }

  // Leftovers from E2E runs: the spec deactivates its fixture rather than deleting it, so they
  // accumulate. Only ever removes rows nothing references.
  const { rows: junk } = await db.query(
    `SELECT t.id, t.name FROM tests t
      WHERE t.name LIKE 'E2E %'
        AND NOT EXISTS (SELECT 1 FROM visit_tests vt WHERE vt.test_id = t.id)`
  );

  console.log('\n--- UPDATE (price and/or preparation) ---');
  for (const [found, name, price, , priceChanged] of planned.update) {
    console.log(`  ${name.padEnd(40)} ${String(found.price).padStart(9)} -> ${price.toFixed(2).padStart(9)}${priceChanged ? '' : '   (preparation only)'}`);
  }
  console.log('\n--- INSERT (new services) ---');
  planned.insert.forEach(([n, p]) => console.log(`  ${n.padEnd(40)} ${p.toFixed(2).padStart(9)}`));
  console.log('\n--- ALREADY CORRECT ---');
  planned.unchanged.forEach((n) => console.log(`  ${n}`));
  console.log('\n--- DELETE (unreferenced E2E fixtures) ---');
  junk.forEach((j) => console.log(`  ${j.name}`));

  if (!confirm) {
    console.log('\nDry run. Nothing written. Re-run with --confirm to apply.');
    process.exit(0);
  }

  await db.withTransaction(async () => {
    for (const [found, name, price, prep] of planned.update) {
      await db.query(
        `UPDATE tests
            SET name = $1, price = $2,
                preparation = COALESCE(NULLIF(TRIM($3), ''), preparation),
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $4`,
        [name, price, prep, found.id]
      );
    }
    for (const [name, price, prep] of planned.insert) {
      await db.query(
        `INSERT INTO tests (category_id, name, price, preparation, is_active)
         VALUES ($1, $2, $3, NULLIF(TRIM($4), ''), TRUE)`,
        [labId, name, price, prep]
      );
    }
    for (const j of junk) {
      await db.query(`DELETE FROM tests WHERE id = $1`, [j.id]);
    }
  });

  const { rows: after } = await db.query(
    `SELECT COUNT(*)::int AS n FROM tests WHERE category_id = $1 AND is_active`,
    [labId]
  );
  logger.info(`Done. ${after[0].n} active laboratory services.`);
  console.log('\nSTILL NEEDED FROM THE CLINIC:');
  console.log('  * Ultrasound / X-Ray / 2D Echo / ECG prices — the source sheet is laboratory only,');
  console.log('    so those categories still hold demo figures.');
  console.log('  * Confirmation of the OGTT 75g fasting wording (added to match FBS).');
  console.log('  * Preparation text for any other test that needs it — blank means the day-before');
  console.log('    reminder carries no instruction.');
  process.exit(0);
}

main().catch((err) => {
  logger.error(`Catalogue seed failed: ${err.message}`);
  process.exit(1);
});
