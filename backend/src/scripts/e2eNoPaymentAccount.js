/**
 * What a patient's booking answers when the clinic has no payment account published. [1.153.0]
 *
 * A spec cannot hide the published accounts: on this database one of them is the clinic's real
 * GCash, and every other spec running needs it. So this hides them inside a transaction, tries the
 * booking through the real service, prints what happened, and rolls everything back. Nothing is
 * ever committed, and no other connection sees the change.
 *
 * REFUSES TO RUN IN PRODUCTION.
 *
 *   node src/scripts/e2eNoPaymentAccount.js --user=123 --patient=456 --test=7 --date=2027-03-01 --time=09:00
 *
 * Prints one line: OUTCOME {"status":409,"message":"…"}, or OUTCOME {"status":"skipped"} when the
 * payment gateway is on, which keeps online booking open by itself.
 */
require('dotenv').config();
const db = require('../config/database');
const appointmentService = require('../services/appointmentService');
const paymentGatewayService = require('../services/paymentGatewayService');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

class Undo extends Error {}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('no-payment-account refused: NODE_ENV=production');
    process.exit(1);
  }
  if (paymentGatewayService.isConfigured()) {
    console.log('OUTCOME {"status":"skipped"}');
    process.exit(0);
  }

  let outcome = { status: 201, message: 'The booking went through.' };
  try {
    await db.withTransaction(async () => {
      await db.query('UPDATE payment_methods SET is_active = FALSE');
      try {
        await appointmentService.createAppointment({
          patientId: Number(arg('patient')),
          scheduledDate: arg('date'),
          scheduledTime: arg('time'),
          notes: null,
          createdBy: Number(arg('user')),
          requestingUser: { userId: Number(arg('user')), roles: ['Client'], permissions: [] },
          testIds: [Number(arg('test'))],
          packageIds: [],
          hmo: null,
          hmoCardFile: null,
          doctorRequestFile: null,
          referral: {},
          payNow: null,
          discountClaim: null,
          discountIdFile: null,
        });
      } catch (err) {
        outcome = { status: err.statusCode || 500, message: err.message };
      }
      throw new Undo();
    });
  } catch (err) {
    if (!(err instanceof Undo)) throw err;
  }
  console.log(`OUTCOME ${JSON.stringify(outcome)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`no-payment-account failed: ${err.message}`);
  process.exit(1);
});
