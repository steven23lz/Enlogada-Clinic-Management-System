const paymentRepository = require('../repositories/paymentRepository');
const discountService = require('./discountService');
const db = require('../config/database');
const notificationService = require('./notificationService');
const visitService = require('./visitService');
const auditService = require('./auditService');

// Feature Gap Plan Phase A: payment_status's CHECK constraint has allowed 'Refunded'/'Cancelled'
// since the schema baseline, but no endpoint ever set them — a duplicate or disputed charge had
// no reversal path anywhere in the app.
const REVERSIBLE_TARGET_STATUSES = ['Refunded', 'Cancelled'];

class PaymentService {
  async getBillingSummary(visitId) {
    const { visitInfo, items } = await paymentRepository.getBillingSummary(visitId);
    if (!visitInfo) {
      const error = new Error('Visit not found');
      error.statusCode = 404;
      throw error;
    }

    const subtotal = items.reduce((sum, item) => sum + parseFloat(item.price_at_time), 0);
    // HMO coverage is earned per test, from an actually-approved hmo_request_tests row (Module
    // 15's data) — not assumed wholesale from the patient's billing category. A patient
    // registered under the "HMO" patient_type with no approved request for a given test pays
    // for that test in full; a patient with only some tests approved gets partial coverage.
    const hmoCoverage = items
      .filter((item) => item.hmo_approval_status === 'Approved')
      .reduce((sum, item) => sum + parseFloat(item.price_at_time), 0);

    // Statutory (Senior Citizen / PWD) and commercial discounts, applied to the patient's own
    // out-of-pocket amount rather than the gross subtotal — see discountService.computeDiscount,
    // which also documents why VAT is left explicit rather than assumed.
    const discountAmount = discountService.computeDiscount({
      subtotal,
      hmoCoverage,
      percentage: visitInfo.discount_percentage,
    });
    const totalAmount = subtotal - hmoCoverage - discountAmount;

    const formattedItems = items.map(item => ({
      id: item.visit_test_id,
      name: item.test_name,
      category: item.category_name,
      price: parseFloat(item.price_at_time).toFixed(2),
      status: item.status,
      hmoApproved: item.hmo_approval_status === 'Approved'
    }));

    return {
      visitId,
      patientName: `${visitInfo.first_name} ${visitInfo.last_name}`,
      patientType: visitInfo.patient_type_name,
      items: formattedItems,
      subtotal: subtotal.toFixed(2),
      hmoCoverage: hmoCoverage.toFixed(2),
      discountAmount: discountAmount.toFixed(2),
      // Null when no discount is claimed. The cashier's screen and the receipt both need the
      // name, rate and ID number, not just the peso figure — a statutory deduction has to be
      // itemised and attributable, not folded silently into the total.
      discount: visitInfo.discount_type_id
        ? {
            id: visitInfo.discount_type_id,
            name: visitInfo.discount_name,
            percentage: parseFloat(visitInfo.discount_percentage).toFixed(2),
            isStatutory: visitInfo.discount_is_statutory,
            idNumber: visitInfo.discount_id_number,
          }
        : null,
      totalAmount: totalAmount.toFixed(2)
    };
  }

  async processPayment({ patientVisitId, processedBy, paymentMethod, referenceNumber, amount }) {
    // Recompute the authoritative bill server-side — also serves as the visit-exists check —
    // rather than trusting the client-submitted amount outright.
    const bill = await this.getBillingSummary(patientVisitId);

    const alreadyPaid = await paymentRepository.hasPaidPayment(patientVisitId);
    if (alreadyPaid) {
      const error = new Error('This visit has already been paid. Refresh the billing queue.');
      error.statusCode = 409;
      throw error;
    }

    const authoritativeTotal = parseFloat(bill.totalAmount);
    const submittedAmount = parseFloat(amount);
    if (isNaN(submittedAmount) || Math.abs(submittedAmount - authoritativeTotal) > 0.01) {
      const error = new Error(`Submitted amount (₱${amount}) does not match the billed total (₱${authoritativeTotal.toFixed(2)}).`);
      error.statusCode = 400;
      throw error;
    }

    // Taking the money and releasing the visit is one event, so it commits as one.
    //
    // These were four independent auto-committed writes. Dying anywhere in the middle — deploy,
    // process restart, OOM — left the clinic in a state no screen can explain and no user can
    // repair:
    //
    //   payment written, visit not released:  the patient has paid, but the visit is still
    //     'Pending' and its tests are still 'Pending', and every modality worklist filters on
    //     pv.status = 'Processing'. The ticket is invisible to every department. The cashier
    //     cannot retake the payment either — hasPaidPayment now returns true, so the retry is
    //     rejected with "already been paid". The patient waits for an exam nobody can see.
    //
    //   payment written, stale gateway row not cancelled: an abandoned GCash session stays
    //     'Pending' against a settled visit and keeps being offered back to the patient.
    //
    // releaseVisitIfReady is included deliberately: it is the step that makes the payment
    // *mean* something operationally, and it is internally atomic already, so joining this
    // transaction just extends the same guarantee across the pair.
    const receiptNumber = await paymentRepository.getNextReceiptNumber();

    const payment = await db.withTransaction(async () => {
      const created = await paymentRepository.createPayment({
        patientVisitId,
        processedBy,
        paymentMethod,
        referenceNumber,
        receiptNumber,
        amount: authoritativeTotal,
        // Snapshotted from the bill just computed, so the receipt and the statutory register
        // record what was actually deducted rather than re-deriving it later from a catalogue
        // that may since have changed.
        discountAmount: parseFloat(bill.discountAmount || 0),
        discountTypeName: bill.discount?.name || null,
        discountIdNumber: bill.discount?.idNumber || null
      });

      // A counter payment supersedes any online checkout the patient started but never finished
      // for this visit — otherwise an abandoned GCash/Maya session would linger as a 'Pending'
      // payment row against an already-settled visit.
      await paymentRepository.cancelPendingGatewayPayments(patientVisitId);

      // Payment is one of the two release conditions. Attempting the release here — server-side,
      // in the same call that took the money — replaces the CashierDashboard's separate follow-up
      // PATCH, where a network blip between the two requests stranded a fully paid visit at
      // 'Pending' with no ticket ever reaching a modality. A walk-in releases immediately; an
      // appointment still waits for its QR check-in, and this is a no-op until then.
      await visitService.releaseVisitIfReady(patientVisitId);

      return created;
    });

    // Module 18 (Notification): Admin/SuperAdmin financial oversight, matching Reports/Cashier
    // Monitoring — not the processing Cashier themselves, who already sees this live in their
    // own receipt flow.
    await notificationService.notifyRoles(['Admin', 'SuperAdmin'], {
      title: 'Payment Confirmed',
      message: `Receipt #${receiptNumber} — ${bill.patientName}, ₱${authoritativeTotal.toFixed(2)}`,
      type: 'success'
    });

    return payment;
  }

  async updatePaymentStatus(paymentId, { status, reason }, requestingUser) {
    if (!REVERSIBLE_TARGET_STATUSES.includes(status)) {
      const error = new Error(`Status must be one of: ${REVERSIBLE_TARGET_STATUSES.join(', ')}`);
      error.statusCode = 400;
      throw error;
    }

    const payment = await paymentRepository.findById(paymentId);
    if (!payment) {
      const error = new Error('Payment not found');
      error.statusCode = 404;
      throw error;
    }
    if (payment.payment_status !== 'Paid') {
      const error = new Error(`Only a 'Paid' payment can be ${status.toLowerCase()}. This payment is currently '${payment.payment_status}'.`);
      error.statusCode = 409;
      throw error;
    }

    const updated = await paymentRepository.updatePaymentStatus(paymentId, status, reason);

    await notificationService.notifyRoles(['Admin', 'SuperAdmin'], {
      title: `Payment ${status}`,
      message: `Receipt #${payment.receipt_number} — ₱${parseFloat(payment.amount).toFixed(2)}${reason ? `: ${reason}` : ''}`,
      type: 'warning'
    });

    await auditService.log({
      actorId: requestingUser?.userId,
      action: `payment.${status.toLowerCase()}`,
      entityType: 'payment',
      entityId: paymentId,
      description: `Marked payment ${payment.receipt_number || `#${paymentId}`} (₱${parseFloat(payment.amount).toFixed(2)}) as ${status}${reason ? ` — ${reason}` : ''}`
    });

    return updated;
  }

  async getTransactions({ startDate, endDate }) {
    return await paymentRepository.findTransactions({ startDate, endDate });
  }

  async getPaymentsForVisit(visitId) {
    return await paymentRepository.findPaymentsByVisitId(visitId);
  }

  async getPaymentsForClient(userId) {
    return await paymentRepository.findPaymentsByPatientUserId(userId);
  }
}

module.exports = new PaymentService();
