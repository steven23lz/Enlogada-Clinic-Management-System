/**
 * Additive migration [1.45.0] — the clinic's package deals.
 *
 * The printed price list sells five bundles (A–E, ₱1,450–₱2,400), each combining laboratory work
 * with a Pelvic Ultrasound. They have never existed in the system, so reception has been adding
 * the component tests one by one and the patient has been charged the sum of the parts — which is
 * always MORE than the package price. Package A is ₱1,450; its components at list are ₱1,830.
 *
 * ── Why a package cannot be a `tests` row ────────────────────────────────────────────────────
 *
 * A `tests` row has exactly one `category_id`, and that is what routes the work to a department
 * worklist. Package A contains CBC (Laboratory) and a Pelvic Ultrasound (Ultrasound). As one row
 * it would land on one worklist and the other department would never see its half of the work.
 *
 * So a package is its own thing that DECOMPOSES into real tests. At booking it expands into one
 * `visit_tests` row per component, exactly as if reception had added them individually — every
 * downstream screen (worklists, results, HMO claims, release gating) keeps working unchanged
 * because it is looking at ordinary visit_tests.
 *
 * ── How the money works ──────────────────────────────────────────────────────────────────────
 *
 * The package price is spread across its components in proportion to their list prices, and the
 * rounding remainder goes on the largest one, so the components sum to the package price EXACTLY.
 *
 *     Package A ₱1,450, components at list ₱1,830
 *       CBC          180 -> 142.62      Pelvic Ultrasound 500 -> 396.17
 *       Urinalysis    90 ->  71.31      Hepa B Screening  190 -> 150.55
 *       Blood Typing 190 -> 150.55      HIV                 0 ->   0.00
 *                                                          sum = 1450.00
 *
 * Nothing else in the billing chain has to know packages exist. `visit_tests.price_at_time` is
 * already the source of truth for a visit's subtotal, the statutory Senior/PWD discount already
 * applies on top of that subtotal, and `reportRepository` already apportions revenue per test
 * from the same column — so per-department reporting stays right without a special case.
 *
 * The alternative — one line at the package price plus a discount line — was rejected because it
 * puts the whole bundle in one department's revenue and leaves the other showing work it did for
 * nothing.
 *
 * ── `visit_tests.package_id` ─────────────────────────────────────────────────────────────────
 *
 * Records which package a line came from, so a receipt can say "Package A" once instead of
 * listing six components at prices that look arbitrary on their own (₱142.62 for a CBC invites a
 * question the cashier cannot answer). Nullable: a test added on its own has no package.
 *
 * Additive and idempotent. Reversible:
 *   node src/scripts/migrateTestPackages.js
 *   node src/scripts/migrateTestPackages.js --rollback
 */
const db = require('../config/database');
const logger = require('../config/logger');

async function migrate(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS test_packages (
      id SERIAL PRIMARY KEY,
      -- The letter the printed sheet and the whole front desk already use. Short, stable, and
      -- what a patient says on the phone ("I want Package B").
      code VARCHAR(20) NOT NULL UNIQUE,
      name VARCHAR(150) NOT NULL,
      price NUMERIC(10,2) NOT NULL,
      description TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT chk_test_packages_price CHECK (price >= 0)
    )
  `);
  logger.info('  + test_packages');

  await client.query(`
    CREATE TABLE IF NOT EXISTS test_package_items (
      id SERIAL PRIMARY KEY,
      package_id INT NOT NULL,
      test_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_package_items_package FOREIGN KEY (package_id)
        REFERENCES test_packages(id) ON DELETE CASCADE,
      CONSTRAINT fk_package_items_test FOREIGN KEY (test_id) REFERENCES tests(id),
      -- A package lists a test once. Twice would double-charge inside a fixed price and then
      -- collide with uq_visit_tests_visit_test on expansion.
      CONSTRAINT uq_package_items UNIQUE (package_id, test_id)
    )
  `);
  logger.info('  + test_package_items');

  await client.query(`
    ALTER TABLE visit_tests ADD COLUMN IF NOT EXISTS package_id INT
  `);
  // Added separately and guarded, because ADD COLUMN IF NOT EXISTS does not carry the constraint
  // on a re-run and a duplicate FK is an error rather than a no-op.
  const { rows: fk } = await client.query(`
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_visit_tests_package'
  `);
  if (fk.length === 0) {
    await client.query(`
      ALTER TABLE visit_tests
        ADD CONSTRAINT fk_visit_tests_package FOREIGN KEY (package_id) REFERENCES test_packages(id)
    `);
  }
  logger.info('  + visit_tests.package_id');

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_package_items_package ON test_package_items (package_id)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_package_items_test ON test_package_items (test_id)
  `);
  // Partial: the overwhelming majority of visit_tests are not part of a package, and there is no
  // reason to carry them in an index whose only question is "which lines came from a package".
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_visit_tests_package ON visit_tests (package_id)
     WHERE package_id IS NOT NULL
  `);
  logger.info('  + indexes');
}

async function rollback(client) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM visit_tests WHERE package_id IS NOT NULL`
  ).catch(() => ({ rows: [{ n: 0 }] }));
  if (rows[0].n > 0) {
    logger.warn(`  ! ${rows[0].n} booked line(s) will lose the record of which package they came from`);
    logger.warn('    (the lines and their prices survive — only the grouping is dropped)');
  }

  await client.query('DROP INDEX IF EXISTS idx_visit_tests_package');
  await client.query('ALTER TABLE visit_tests DROP CONSTRAINT IF EXISTS fk_visit_tests_package');
  await client.query('ALTER TABLE visit_tests DROP COLUMN IF EXISTS package_id');
  logger.info('  - visit_tests.package_id');
  await client.query('DROP TABLE IF EXISTS test_package_items');
  logger.info('  - test_package_items');
  await client.query('DROP TABLE IF EXISTS test_packages');
  logger.info('  - test_packages');
}

async function main() {
  const reversing = process.argv.includes('--rollback');
  logger.info(`[1.45.0] ${reversing ? 'Rolling back' : 'Applying'} test packages…`);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (reversing) await rollback(client);
    else await migrate(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`[1.45.0] Failed, nothing changed: ${err.message}`);
    client.release();
    process.exit(1);
  }
  client.release();

  if (!reversing) {
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM test_packages`)
      .catch(() => ({ rows: [{ n: 0 }] }));
    logger.info(`[1.45.0] Done. ${rows[0].n} package(s) defined — run seedRealCatalogue.js to load them.`);
  } else {
    logger.info('[1.45.0] Done.');
  }
  process.exit(0);
}

main().catch((err) => {
  logger.error(`[1.45.0] Migration failed: ${err.message}`);
  process.exit(1);
});
