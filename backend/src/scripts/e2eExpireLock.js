/**
 * Runs out a test account's sign-in lock now, so a spec can test what happens after one. [1.85.0]
 *
 * A lock lasts fifteen minutes by wall-clock, which no API can fast-forward, and the bug [1.85.0]
 * fixed lives entirely after it: the first slip once a lock had run out locked the account again,
 * because the failure count still stood at the threshold. Without a way to age the lock, only the
 * half that already worked could be tested.
 *
 * Shelled out to from frontend/tests/e2e/helpers/backendScript.js, like e2eExpireHold.js, and for
 * the reason globalTeardown.js gives: the credentials and the `pg` client live here.
 *
 * Guards, each about what it may touch:
 *   - NODE_ENV must not be 'production'
 *   - only an @enlogada-e2e.test address, so no staff or patient account can be unlocked by it
 *   - only an account that is locked right now
 *
 * It moves `locked_until` to a second ago and leaves the failure count alone, because the count is
 * the thing under test.
 *
 *   node src/scripts/e2eExpireLock.js --email=lockout_1@enlogada-e2e.test
 */
require('dotenv').config();
const db = require('../config/database');

const E2E_DOMAIN = '@enlogada-e2e.test';

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('expire-lock refused: NODE_ENV=production');
    process.exit(1);
  }

  const email = String(arg('email') || '').trim().toLowerCase();
  if (!email.endsWith(E2E_DOMAIN)) {
    console.error(`expire-lock refused: ${email || '(no --email)'} is not a ${E2E_DOMAIN} address`);
    process.exit(1);
  }

  const { rows } = await db.query(
    `UPDATE users
        SET locked_until = CURRENT_TIMESTAMP - INTERVAL '1 second'
      WHERE LOWER(email) = $1 AND locked_until > CURRENT_TIMESTAMP
      RETURNING id, failed_login_count`,
    [email]
  );
  if (rows.length === 0) {
    console.error(`expire-lock refused: ${email} is not locked`);
    process.exit(1);
  }

  console.log(`ran out the lock on user ${rows[0].id} (failure count left at ${rows[0].failed_login_count})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`expire-lock failed: ${err.message}`);
  process.exit(1);
});
