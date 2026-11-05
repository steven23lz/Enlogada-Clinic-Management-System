const db = require('../config/database');
const paymentRefundRepository = require('../repositories/paymentRefundRepository');
const visitRepository = require('../repositories/visitRepository');
const appointmentRepository = require('../repositories/appointmentRepository');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const appointmentEmailService = require('./appointmentEmailService');
const logger = require('../config/logger');
const { formatCurrency } = require('../utils/money');
const { COUNTER_METHODS, CASH_METHOD } = require('../constants/paymentMethods');
const { REFUND_KINDS, refundShares, whyNotRefundable } = require('../utils/refundRules');

const REASON_MAX = 500;

const fail = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

/**
 * Giving money back. [1.155.0]
 *
 * A paid receipt is final: a patient changing their mind gets nothing back. Steven reopened this for the
 * two cases that rule could not answer: the clinic cannot do a test it took money for, and a payment
 * recorded by mistake. [1.121.0] removed the old refund for good reasons, and each is answered here:
 *
 *   One person could take money and hand it back alone   SuperAdmin only, and never their own receipt
 *   A refunded receipt still read as paid                the receipt says so, on screen and on paper
 *   Only a whole receipt could be reversed               refunds are per test
 *   Nothing recorded how the money went back             method, reference, who, when and why
 *
 * Never for a test whose exam was done or report released: the clinic did what was paid for. Nothing here
 * is hidden: the Activity Log, the cash book, the drawer count and the patient all hear about it.
 */
class PaymentRefundService {
  /** Each test with what it would give back, and why it cannot if it cannot. */
  async linesFor(payment) {
    const tests = await paymentRefundRepository.findVisitTests(payment.patient_visit_id);
    const shares = refundShares(tests, payment.amount);
    return tests.map((t) => {
      const share = shares.get(t.id);
      return {
        id: t.id,
        name: t.name,
        status: t.status,
        amount: share,
        whyNot: whyNotRefundable({ ...t, share }),
        hmoApproved: t.hmoApproved,
      };
    });
  }

  /** Refused for the receipt as a whole: not paid, or the person's own. */
  whyNotAtAll(payment, user) {
    if (payment.payment_status !== 'Paid' || !payment.receipt_number) return 'This receipt is not a settled payment, so there is nothing to refund.';
    if (Number(payment.processed_by) === Number(user.userId)) {
      return 'You took this payment yourself, so someone else has to refund it. One person never both takes money and hands it back.';
    }
    return null;
  }

  /** What the refund dialog shows. */
  async options(paymentId, user) {
    const payment = await paymentRefundRepository.findPaymentWithPatient(paymentId);
    if (!payment) throw fail(404, 'Payment not found.');
    const lines = await this.linesFor(payment);
    const refunded = await paymentRefundRepository.totalRefunded(payment.id);
    return {
      paymentId: payment.id,
      receiptNumber: payment.receipt_number,
      patientName: `${payment.first_name} ${payment.last_name}`,
      amount: payment.amount,
      paymentMethod: payment.payment_method,
      refunded,
      remaining: Math.round((Number(payment.amount) - refunded) * 100) / 100,
      blocked: this.whyNotAtAll(payment, user),
      kinds: Object.entries(REFUND_KINDS).map(([value, label]) => ({ value, label })),
      tests: lines,
    };
  }

  /**
   * @param {number} paymentId
   * @param {{kind: string, testIds?: number[], reason: string, returnedVia: string, returnedReference?: string}} request
   * @param {object} user  the SuperAdmin; the route lets nobody else this far
   */
  async refund(paymentId, { kind, testIds, reason, returnedVia, returnedReference }, user) {
    if (!REFUND_KINDS[kind]) throw fail(400, 'Say why: the clinic cannot perform the test, or the payment was recorded by mistake.');
    const why = String(reason ?? '').trim();
    if (!why) throw fail(400, 'Write what happened. It is kept with the refund, and the patient is told.');
    if (why.length > REASON_MAX) throw fail(400, `Keep the reason under ${REASON_MAX} characters.`);
    if (!COUNTER_METHODS.includes(returnedVia)) throw fail(400, 'Say how the money goes back: Cash, GCash or Bank.');
    const reference = String(returnedReference ?? '').trim();
    if (returnedVia !== CASH_METHOD && !reference) throw fail(400, `Enter the ${returnedVia} reference of the money sent back.`);

    const outcome = await db.withTransaction(async () => {
      const locked = await paymentRefundRepository.lockPayment(paymentId);
      if (!locked) throw fail(404, 'Payment not found.');
      const blocked = this.whyNotAtAll(locked, user);
      if (blocked) throw fail(409, blocked);
      const visitId = locked.patient_visit_id;
      const lines = await this.linesFor(locked);

      // ── Which tests ───────────────────────────────────────────────────────────────────────────
      const mistake = kind === 'recorded_by_mistake';
      let chosen;
      if (mistake) {
        // The whole receipt, so every test on it has to be untouched: an exam done for the wrong
        // patient's money is a different problem, and giving the money back would hide it.
        const done = lines.find((l) => !l.hmoApproved && l.whyNot && !/refunded|cancelled/i.test(l.whyNot));
        if (done) throw fail(409, `${done.name}: ${done.whyNot} A receipt recorded by mistake can only go back while none of its tests are done.`);
        chosen = lines.filter((l) => !l.whyNot);
      } else {
        const ids = [...new Set((Array.isArray(testIds) ? testIds : []).map(Number))];
        if (!ids.length) throw fail(400, 'Choose the test the clinic cannot perform.');
        chosen = ids.map((id) => {
          const line = lines.find((l) => l.id === id);
          if (!line) throw fail(400, 'One of those tests is not on this receipt.');
          if (line.whyNot) throw fail(409, `${line.name}: ${line.whyNot}`);
          return line;
        });
      }
      const amount = Math.round(chosen.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;
      if (!(amount > 0)) throw fail(409, 'There is nothing left on this receipt to give back.');

      // ── The record ────────────────────────────────────────────────────────────────────────────
      const refund = await paymentRefundRepository.create({
        paymentId: locked.id, amount, kind, reason: why, returnedVia,
        returnedReference: reference || null, refundedBy: user.userId, tests: chosen,
      });

      // ── What happens to the visit ─────────────────────────────────────────────────────────────
      let visitNow = null;
      if (mistake) {
        await paymentRefundRepository.markRefunded(locked.id, { reason: why, fullyBack: true });
        await paymentRefundRepository.returnVisitToUnpaid(visitId);
        // A patient's own booking gets its time to pay again; one made at the desk simply owes.
        await appointmentRepository.reholdForPayment(visitId);
        visitNow = 'Pending';
      } else {
        await paymentRefundRepository.cancelTests(chosen.map((l) => l.id));
        const left = lines.filter((l) => !l.whyNot?.match(/cancelled|refunded/i) && !chosen.some((c) => c.id === l.id));
        await paymentRefundRepository.markRefunded(locked.id, { reason: why, fullyBack: left.length === 0 });
        if (left.length === 0) {
          // Nothing left to do: the visit is over, and a booking's slot goes back on offer.
          await visitRepository.updateVisitStatus(visitId, 'Cancelled');
          await paymentRefundRepository.cancelAppointmentOfVisit(visitId);
          visitNow = 'Cancelled';
        } else if (!(await visitRepository.hasOutstandingTests(visitId))) {
          // The cancelled test was the last thing being waited for.
          await visitRepository.updateVisitStatus(visitId, 'Completed');
          visitNow = 'Completed';
        }
      }

      await auditService.log({
        actorId: user.userId,
        action: 'payment.refunded',
        entityType: 'payment',
        entityId: locked.id,
        description: `${formatCurrency(amount)} back from receipt ${locked.receipt_number} by ${returnedVia}`
          + `${reference ? ` (${reference})` : ''}: ${REFUND_KINDS[kind]} (${chosen.map((l) => l.name).join(', ')}). ${why}`,
      });

      return { refund, amount, chosen, visitNow, receiptNumber: locked.receipt_number };
    });

    // ── Told after the commit ───────────────────────────────────────────────────────────────────
    const payment = await paymentRefundRepository.findPaymentWithPatient(paymentId);
    const patientName = `${payment.first_name} ${payment.last_name}`;
    await notificationService.notifyRoles(['Admin', 'SuperAdmin'], {
      title: 'Payment refunded',
      message: `${formatCurrency(outcome.amount)} back from receipt ${outcome.receiptNumber} — ${patientName}`,
      type: 'warning',
    }).catch(() => {});
    appointmentEmailService.sendRefund({
      to: payment.patient_email,
      patientName,
      receiptNumber: outcome.receiptNumber,
      amount: formatCurrency(outcome.amount),
      tests: outcome.chosen.map((l) => l.name),
      reason: why,
      returnedVia,
      owesAgain: kind === 'recorded_by_mistake',
    }).catch((err) => logger.error(`Refund email failed: ${err.message}`));

    return {
      id: outcome.refund.id,
      amount: outcome.amount,
      receiptNumber: outcome.receiptNumber,
      tests: outcome.chosen.map((l) => ({ id: l.id, name: l.name, amount: l.amount })),
      visitStatus: outcome.visitNow,
    };
  }
}

module.exports = new PaymentRefundService();
