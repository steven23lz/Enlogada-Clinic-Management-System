/**
 * Says, once at boot, when the database holds data a migration would repair. [1.32.0]
 *
 * It does NOT repair anything. That distinction is the whole design.
 *
 * The problem it solves is a collaboration one. [1.30.0] backfilled `payments.refunded_at` from
 * `paid_at` — a fabricated date, chosen because it reproduced the old behaviour exactly and so
 * moved no figure. [1.32.0] replaces that with the real moment from `audit_log` and corrects rows
 * already carrying the guess. But a database that already ran [1.30.0] only gets the correction if
 * somebody re-runs the script, and nothing about pulling the commit makes that happen: this
 * project has no migration ledger, no lifecycle hooks, and no schema-version check. Until then the
 * cash-up files every pre-existing reversal on the day the receipt was taken rather than the day
 * the money went back — silently, and looking entirely normal.
 *
 * ── Why it advises rather than acts ──────────────────────────────────────────────────────────
 *
 * Running the migration here was the obvious idea and is the wrong one:
 *
 *   - `audit_log` has no index on `action`, and the backfill's driving subquery aggregates over
 *     every 'payment'-typed row in it. That table is documented as reaching ~300,000 rows in a
 *     year because PHI reads are audited too, and non-PHI actions are kept ~7 years, so it only
 *     grows. A boot-time scan of it competes with live traffic against a 15s `statement_timeout`.
 *   - The migration scripts call `db.pool.connect()` directly, which CLAUDE.md licenses precisely
 *     because they "run alone". A boot hook voids that assumption against a pool of 10.
 *   - migrations.md records what happened the one time schema work hid inside a script that ran
 *     for another reason: `setupRbac.js` created tables ad hoc, and re-running `migrateDb.js`
 *     silently dropped a foreign key without recreating it. Migrations here are explicit on
 *     purpose.
 *
 * So this is the honest middle: the cheap half of the question — "is there anything to repair" —
 * asked at boot, with the expensive half left to the script a human or their agent runs.
 *
 * ── Why it is cheap ─────────────────────────────────────────────────────────────────────────
 *
 * It touches only `payments`, never `audit_log`, and `idx_payments_refunded_at` is partial on
 * `refunded_at IS NOT NULL` — so the scan is over reversals alone, which are a handful against a
 * table taking hundreds of rows a week. `LIMIT 1` stops at the first hit.
 *
 * `refunded_at = paid_at` to the microsecond is the signature of the backfill. A real reversal is
 * never in the same microsecond as the payment it reverses, so this cannot misread live data.
 *
 * Never fails startup, never throws, and says nothing when there is nothing to say — including on
 * a database that predates the column entirely, where the query errors and is swallowed. A clinic
 * backend that refused to boot over a reporting nicety would be a worse bug than the one this
 * points at.
 */
const db = require('./database');
const paymentGatewayService = require('../services/paymentGatewayService');
const logger = require('./logger');

async function reportPendingRepairs() {
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n
         FROM payments
        WHERE refunded_at IS NOT NULL
          AND refunded_at = paid_at`
    );
    if (rows[0]?.n > 0) {
      logger.warn(
        `[1.32.0] ${rows[0].n} reversal(s) carry a backfilled date equal to their payment time, ` +
        'so the cash-up files them on the day the receipt was taken rather than the day the money ' +
        'went back. Repair with: node src/scripts/migrateRefundTimestamp.js'
      );
    }
  } catch {
    // A database without the column, or without permission to read it, is not this function's
    // problem to report. Silence is correct: the migration list is the place that speaks about a
    // schema behind the code.
  }
}

/**
 * Says, once at boot, when online payment is half-configured. [1.37.0]
 *
 * The two PayMongo secrets come from different screens and the webhook one is displayed exactly
 * once, so having one and not the other is the ordinary way to get this wrong rather than an
 * exotic one. isConfigured() now requires both, which makes the half-configured state safe — the
 * clinic falls back to counter payments — but safe and silent is still a clinic wondering why the
 * Pay button never appeared. This names the missing half.
 *
 * Deliberately not a startup failure. A clinic with no gateway at all is a supported, documented
 * configuration, and refusing to boot over a payment option would take the whole system down to
 * report something the front desk can work around all day.
 */
function reportGatewayConfiguration() {
  const missing = paymentGatewayService.missingGatewaySecret();
  if (!missing) return;
  logger.warn(
    `[gateway] Online payment is OFF because ${missing} is not set. PayMongo issues the API key ` +
    'and the webhook signing secret separately, and both are required — with only one, a patient ' +
    'could be charged with nothing recorded. Set it in backend/.env and restart. See ' +
    '.env.example, and CLAUDE.md for the ordered steps.'
  );
}

module.exports = { reportPendingRepairs, reportGatewayConfiguration };
