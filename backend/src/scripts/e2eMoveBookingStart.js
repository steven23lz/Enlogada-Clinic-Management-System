/**
 * Moves an E2E booking's start to a few minutes ago, so a spec can test what happens after an
 * appointment time has passed. [1.146.0] No API books a time that has gone, which is the point.
 *
 * REFUSES TO RUN IN PRODUCTION, and refuses any booking whose patient is not a test fixture: the
 * reserved number 09000000000 every fixture is registered with (tests/e2e/helpers/people.js), or a
 * profile owned by an @enlogada-e2e.test account. Only the date and time move; a held booking's
 * held_until is left as it is, as a booking whose time came would have it.
 *
 *   node src/scripts/e2eMoveBookingStart.js --appointment=123 --minutes-ago=5
 *   node src/scripts/e2eMoveBookingStart.js --appointment=123 --days-ago=1   # same time, N days back
 *
 * [1.148.0] --days-ago makes a booking whose DAY has passed (a missed paid booking), which
 * --minutes-ago cannot do during the day: ten hours before 14:00 is still today.
 */
require('dotenv').config();
const db = require('../config/database');

const FIXTURE_CONTACT = '09000000000';
const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('move-booking-start refused: NODE_ENV=production');
    process.exit(1);
  }
  const appointmentId = Number(arg('appointment'));
  const daysAgo = arg('days-ago') === null ? null : Number(arg('days-ago'));
  const minutesAgo = daysAgo === null ? Number(arg('minutes-ago') || 5) : daysAgo * 24 * 60;
  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    console.error('move-booking-start refused: --appointment=<id> is required');
    process.exit(1);
  }
  if (daysAgo !== null && (!Number.isInteger(daysAgo) || daysAgo < 1 || daysAgo > 7)) {
    console.error('move-booking-start refused: --days-ago must be a whole number from 1 to 7');
    process.exit(1);
  }
  if (daysAgo === null && (!Number.isInteger(minutesAgo) || minutesAgo < 1 || minutesAgo > 600)) {
    console.error('move-booking-start refused: --minutes-ago must be a whole number from 1 to 600');
    process.exit(1);
  }
  // Date and time from one instant, so a run just after midnight does not land later today.
  const { rows } = await db.query(
    `UPDATE appointments a
        SET scheduled_date = (CURRENT_TIMESTAMP - ($2 || ' minutes')::interval)::date,
            scheduled_time = (CURRENT_TIMESTAMP - ($2 || ' minutes')::interval)::time(0),
            updated_at = CURRENT_TIMESTAMP
       FROM patient_visits pv
       JOIN patients p ON p.id = pv.patient_id
       LEFT JOIN users u ON u.id = p.user_id
      WHERE a.id = $1 AND a.patient_visit_id = pv.id
        AND (p.contact_number = $3 OR u.email ILIKE '%@enlogada-e2e.test')
      RETURNING a.id, a.scheduled_date, a.scheduled_time`,
    [appointmentId, minutesAgo, FIXTURE_CONTACT]
  );
  if (rows.length === 0) {
    console.error(`move-booking-start refused: appointment ${appointmentId} is not a test fixture's`);
    process.exit(1);
  }
  console.log(`moved appointment ${rows[0].id} to ${rows[0].scheduled_time}${daysAgo ? `, ${daysAgo} day(s) ago` : ' today'}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`move-booking-start failed: ${err.message}`);
  process.exit(1);
});
