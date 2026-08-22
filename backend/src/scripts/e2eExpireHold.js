/**
 * Lapses an E2E booking's slot hold immediately, so a spec can test abandonment.
 *
 * A hold lasts 15 minutes and expires by wall-clock, which no API can fast-forward. Without a way
 * to age one, the only case that can be tested is the one that already worked — a booking made
 * and paid inside a single test — and the regression [1.35.0] exists for, a patient who walks away
 * mid-payment, has no coverage at all.
 *
 * Shelled out to from the frontend suite, exactly like purgeE2eData.js and e2eBackdatePayment.js,
 * and for the reason globalTeardown.js gives: the credentials and the `pg` client live here.
 *
 * REFUSES TO RUN IN PRODUCTION, and refuses to touch anything but a booking that is ALREADY held.
 * Two independent guards:
 *
 *   - NODE_ENV must not be 'production'
 *   - `held_until IS NOT NULL` — the booking must currently be provisional
 *
 * The second guard is the substantive one, and it is deliberately not an "is this test data" check.
 * The suite books with the seeded client account rather than a throwaway one, so matching on
 * @enlogada-e2e.test refused the very bookings this exists to age. More importantly, a narrower
 * guard would be guarding the wrong thing: the harm this script can do is bounded by what it does,
 * not by whose row it does it to. Lapsing a live hold brings forward, by up to fifteen minutes, an
 * expiry the system performs unattended anyway — and it cannot touch a permanent booking at all,
 * which is every real appointment, every staff booking, every HMO booking and everything paid for.
 *
 * Two modes, because a spec must be able to CONSTRUCT the provisional state as well as end it.
 * A booking only becomes provisional when the payment gateway is configured — with no
 * PAYMONGO_SECRET_KEY the instruction is "pay at the counter" and the booking is permanent by
 * design — so on a machine without a key there is otherwise no way to reach the state at all, and
 * the mechanism this migration exists for would go untested wherever the gateway is off.
 *
 *   node src/scripts/e2eExpireHold.js --appointment=123 --hold     put it into a live hold
 *   node src/scripts/e2eExpireHold.js --appointment=123            lapse the hold now
 */
require('dotenv').config();
const db = require('../config/database');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('expire-hold refused: NODE_ENV=production');
    process.exit(1);
  }

  const appointmentId = Number(arg('appointment'));
  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    console.error('expire-hold refused: --appointment=<id> is required');
    process.exit(1);
  }

  const { rows } = await db.query(
    'SELECT id, held_until FROM appointments WHERE id = $1',
    [appointmentId]
  );
  if (rows.length === 0) {
    console.error(`expire-hold refused: appointment ${appointmentId} does not exist`);
    process.exit(1);
  }
  const putOnHold = process.argv.includes('--hold');

  if (!putOnHold && !rows[0].held_until) {
    console.error(`expire-hold refused: appointment ${appointmentId} is permanent, not held`);
    process.exit(1);
  }

  const { rows: updated } = await db.query(
    `UPDATE appointments
        SET held_until = CURRENT_TIMESTAMP ${putOnHold ? "+ INTERVAL '15 minutes'" : "- INTERVAL '1 second'"}
      WHERE id = $1
      RETURNING id, held_until`,
    [appointmentId]
  );

  console.log(`${putOnHold ? 'held' : 'lapsed hold on'} appointment ${updated[0].id}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`expire-hold failed: ${err.message}`);
  process.exit(1);
});
