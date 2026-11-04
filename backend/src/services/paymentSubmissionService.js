const path = require('path');
const fs = require('fs');
const paymentSubmissionRepository = require('../repositories/paymentSubmissionRepository');
const paymentMethodRepository = require('../repositories/paymentMethodRepository');
const paymentRepository = require('../repositories/paymentRepository');
const paymentService = require('./paymentService');
const discountService = require('./discountService');
const visitRepository = require('../repositories/visitRepository');
const patientRepository = require('../repositories/patientRepository');
const auditService = require('./auditService');
const logger = require('../config/logger');
const notificationService = require('./notificationService');
const { PAYMENT_UPLOAD_ROOT, discardPaymentFile } = require('../config/upload');
const { formatCurrency } = require('../utils/money');
const appointmentEmailService = require('./appointmentEmailService');
const appointmentRepository = require('../repositories/appointmentRepository');
const unpaidExpiryService = require('./unpaidExpiryService');

/**
 * Manual proof of payment: the patient pays into the clinic's own account and a cashier checks it.
 * See migrations.md [1.48.0].
 *
 * ── What this service is careful about ──────────────────────────────────────────────────────
 *
 * The claimed amount is never trusted. On approval the cashier's existing `processPayment` runs,
 * which recomputes the bill server-side and refuses anything that does not match it — so a patient
 * typing ₱50 for a ₱1,450 visit cannot produce a ₱50 payment even if a cashier clicks approve.
 * The claim is a prompt for a human to look at a screenshot, not an instruction to the ledger.
 *
 * Approval also goes through the SAME path a counter payment takes, which is what earns it a real
 * receipt number from `daily_counters`, the visit release, and the cash-up entry. A parallel
 * "verified payment" writer would have been a second way to take money, and the two would have
 * drifted the first time either changed.
 */
class PaymentSubmissionService {
  /** Ownership: a client may only act on a visit belonging to one of their own patient profiles. */
  async assertClientOwnsVisit(user, patientVisitId) {
    if (!user || !user.roles?.includes('Client')) return;
    const visit = await visitRepository.findVisitById(patientVisitId);
    if (!visit) {
      const error = new Error('Visit not found.');
      error.statusCode = 404;
      throw error;
    }
    const profiles = await patientRepository.findPatientsByUserId(user.userId);
    // Compared per patient, never by resolving a user to a single patient: one account owns
    // several profiles (a parent booking for dependents).
    const owns = profiles.some((p) => p.id === visit.patient_id);
    if (!owns) {
      // 404 rather than 403 — the same reason department scoping does it: a 403 confirms the
      // visit exists.
      const error = new Error('Visit not found.');
      error.statusCode = 404;
      throw error;
    }
  }

  /**
   * Records a patient's claim that they have paid, with their screenshot as evidence.
   *
   * @param {object} params
   * @param {number} params.patientVisitId
   * @param {number} [params.paymentMethodId]
   * @param {string} params.referenceNumber  The clinic's only handle on a transfer that happened
   *   inside GCash or a bank.
   * @param {number} [params.amountClaimed]  EVIDENCE, never the amount charged — approval bills
   *   the recomputed total. Omitted, it is the amount the booking asked for. [1.105.0]
   * @param {object} file  The uploaded proof.
   * @param {object} user  A Client may submit only against their own visit.
   * @returns {Promise<object>} The 'Pending' submission. No money moves here.
   *
   * `uq_paysub_one_live_per_visit` allows one Pending claim per visit, so two cashiers cannot be
   * handed the same money twice. It is partial, so a rejected claim never blocks a second attempt.
   */
  async submit({ patientVisitId, paymentMethodId, referenceNumber, amountClaimed }, file, user) {
    if (typeof referenceNumber !== 'string' || !referenceNumber.trim()) {
      discardPaymentFile(file);
      const error = new Error('The transaction reference number is required — it is what the cashier checks against.');
      error.statusCode = 400;
      throw error;
    }
    if (!file) {
      discardPaymentFile(file);
      const error = new Error('A screenshot or photo of the transaction is required.');
      error.statusCode = 400;
      throw error;
    }

    try {
      await this.assertClientOwnsVisit(user, patientVisitId);

      // Already settled? Nothing to claim against. Checked before the unique index so the patient
      // gets a sentence rather than a constraint violation.
      if (await paymentRepository.hasPaidPayment(patientVisitId)) {
        const error = new Error('This visit is already paid.');
        error.statusCode = 409;
        throw error;
      }
      // [1.124.0] Nor for a visit or booking that is over. A probe sent a proof for a CANCELLED
      // booking, and a cashier verifying it would have issued a receipt for a visit with no exam.
      const visit = await visitRepository.findVisitById(patientVisitId);
      if (!visit) {
        const error = new Error('Visit not found.');
        error.statusCode = 404;
        throw error;
      }
      const hold = await appointmentRepository.findHoldByVisitId(patientVisitId);
      if (visit.status === 'Cancelled' || ['Cancelled', 'No Show'].includes(hold?.status)) {
        const error = new Error('This booking was cancelled, so there is nothing to pay. Please book again.');
        error.statusCode = 409;
        throw error;
      }
      // Payment first [1.123.0]: a booking whose payment window ran out has released its slot.
      if (hold?.lapsed) {
        const error = new Error("This booking wasn't paid in time, so its slot was released. Please book again.");
        error.statusCode = 409;
        throw error;
      }
      const live = await paymentSubmissionRepository.findPendingForVisit(patientVisitId);
      if (live) {
        const error = new Error('A payment for this booking is already awaiting review.');
        error.statusCode = 409;
        throw error;
      }

      // [1.151.0] Nothing to pay yet, or nothing to pay at all. A proof sent while the HMO decides
      // cleared the booking's hold for good and could never be approved (the till's own rule
      // refuses a payment over a pending decision), so a rejection left the slot taken, unpaid and
      // undecided, past the reach of the sweep. The portal offers no form here; the server says so too.
      const bill = await paymentService.getBillingSummary(patientVisitId);
      if (Number(bill.hmoPendingCount) > 0) {
        const error = new Error('Your HMO is still deciding on this booking, so there is nothing to pay yet. We email you their answer.');
        error.statusCode = 409;
        throw error;
      }
      if (Number(bill.totalAmount) <= 0) {
        const error = new Error('Your HMO covers this booking in full, so there is nothing to pay.');
        error.statusCode = 409;
        throw error;
      }

      // [1.152.0] One transfer pays for one booking. Says nothing of whose it was. The same reference
      // on this booking again is fine: that is a patient correcting a rejected proof.
      const paidInto = paymentMethodId ? await paymentMethodRepository.findById(paymentMethodId) : null;
      const used = await paymentRepository.findReferenceUse({
        reference: referenceNumber.trim(), method: paidInto?.kind || 'GCash', visitId: patientVisitId,
      });
      if (used) {
        const error = new Error('This reference number has already been used for another payment. Each booking needs its own transfer. Check the number on your confirmation, or contact the clinic.');
        error.statusCode = 409;
        throw error;
      }

      // The portal no longer asks the patient to type an amount. [1.105.0] The booking already
      // states the figure, and an editable box beside it invited them to send something else. A
      // claim that names no amount is a claim to have sent what was asked, so it records that
      // figure. An explicit amount is still accepted, and still only evidence.
      const stated = amountClaimed !== undefined && amountClaimed !== null && String(amountClaimed).trim() !== '';
      if (stated && !Number.isFinite(Number(amountClaimed))) {
        const error = new Error('The amount must be a number.');
        error.statusCode = 400;
        throw error;
      }
      // [1.146.0] The bill approval will record, discount included, not the gross of the tests.
      const claimed = stated ? Number(amountClaimed) : Number(bill.totalAmount);

      const submission = await paymentSubmissionRepository.create({
        patientVisitId,
        paymentMethodId,
        referenceNumber: referenceNumber.trim(),
        amountClaimed: claimed,
        submittedBy: user?.userId,
        proof: {
          filePath: path.basename(file.path),
          originalName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
        },
      });

      // The cashier is told, because nothing else would tell them: a patient paying from home
      // produces no queue ticket and no one at the counter. Without this the claim sits unseen
      // until somebody happens to open the review screen.
      // A proof sent in time keeps the slot while a cashier checks it. [1.123.0] Checking happens
      // in opening hours, so the window must not run out while the proof waits; a rejection starts
      // it again (reject, below).
      await appointmentRepository.confirmHold(patientVisitId);

      await notificationService.notifyRoles(['Cashier', 'Admin', 'SuperAdmin'], {
        title: 'Proof of payment to review',
        message: `Ref ${submission.reference_number} — ${formatCurrency(submission.amount_claimed)} awaiting verification`,
        type: 'info',
      }).catch(() => { /* a notification failure must never lose the claim */ });

      return submission;
    } catch (err) {
      // The row did not land, so the file it pointed at must not survive either.
      discardPaymentFile(file);
      throw err;
    }
  }

  async listPending() {
    const rows = await paymentSubmissionRepository.findPending();
    // "Visit owes" is the bill approval records, from the same function. [1.146.0] The query's
    // sum of the tests left out a discount and HMO cover, so a senior's proof read as short.
    return Promise.all(rows.map(async (row) => ({
      ...row,
      amount_due: (await paymentService.getBillingSummary(row.patient_visit_id)).totalAmount,
    })));
  }

  async listRecentlyReviewed() {
    return await paymentSubmissionRepository.findRecentlyReviewed();
  }

  async listForVisit(patientVisitId, user) {
    await this.assertClientOwnsVisit(user, patientVisitId);
    return await paymentSubmissionRepository.findAllForVisit(patientVisitId);
  }

  /**
   * Approve a claim: take the payment for real.
   *
   * The amount comes from the BILL, not from the claim. `processPayment` recomputes it and refuses
   * a mismatch, so this cannot be used to settle a visit for whatever the patient typed.
   */
  /**
   * Turns a patient's claim into money, through the SAME writer the counter uses.
   *
   * @param {number} id
   * @param {object} actor  The cashier. Needs `billing:process`.
   * @returns {Promise<object>} The settled payment, with its receipt number.
   *
   * Calls `paymentService.processPayment`, deliberately — it earns a real receipt number, the
   * visit release and the cash-up entry, and there is never a parallel money writer. The amount is
   * the recomputed bill, NOT `amount_claimed`.
   */
  async verify(id, actor, { discountIdChecked = false } = {}) {
    const submission = await paymentSubmissionRepository.findById(id);
    if (!submission) {
      const error = new Error('Payment submission not found.');
      error.statusCode = 404;
      throw error;
    }
    if (submission.status !== 'Pending') {
      const error = new Error(`This submission was already ${submission.status.toLowerCase()}.`);
      error.statusCode = 409;
      throw error;
    }

    const method = submission.payment_method_id
      ? await paymentMethodRepository.findById(submission.payment_method_id)
      : null;

    // ── A submission left Pending on a visit that IS paid ──────────────────────────────────────
    //
    // Taking the money and marking the submission are two writes and cannot be one: processPayment
    // owns its own transaction, commits, and issues a receipt number from daily_counters. If the
    // settle below fails after that commit — a dropped connection, a restart — the money is banked
    // and the submission is still Pending.
    //
    // Nothing was lost when that happened, but nothing could fix it either. The row stayed in the
    // cashier's queue forever, and every retry called processPayment, which correctly refused with
    // "This visit has already been paid" — an error about the VISIT, on a screen about a
    // SUBMISSION, with no action that would clear it.
    //
    // So reconcile instead of re-charging: adopt the payment that already exists and close the
    // submission against it. This is the only branch that may settle without taking money, and it
    // is safe precisely because it takes none — hasPaidPayment is the same guard processPayment
    // would have used to refuse.
    const existing = (await paymentRepository.findPaymentsByVisitId(submission.patient_visit_id))
      .find((p) => p.payment_status === 'Paid');
    if (existing) {
      const reconciled = await paymentSubmissionRepository.settle(id, {
        status: 'Verified',
        reviewedBy: actor.userId,
        reviewNote: null,
        paymentId: existing.id,
      });
      if (reconciled) {
        await auditService.log({
          actorId: actor.userId,
          action: 'payment_submission.reconciled',
          entityType: 'payment_submission',
          entityId: reconciled.id,
          // Named distinctly from a normal verification: no money moved here, and a cash-up that
          // cannot tell the two apart is a cash-up that cannot be checked.
          description: `Ref ${reconciled.reference_number} matched to existing receipt ${existing.receipt_number} — no new payment taken`,
        });
        this.notifyPatient(reconciled.id, { verified: true, payment: existing }).catch(() => {});
        return { submission: reconciled, payment: existing, reconciled: true };
      }
    }

    // The authoritative figure, recomputed from the visit.
    const bill = await paymentService.getBillingSummary(submission.patient_visit_id);

    const payment = await paymentService.processPayment({
      patientVisitId: submission.patient_visit_id,
      processedBy: actor.userId,
      // The cash-up bucket, which is exactly why payment_methods.kind is constrained to the three
      // values `payments` accepts. A method that was since retired still settles correctly.
      paymentMethod: method?.kind || 'GCash',
      referenceNumber: submission.reference_number,
      amount: bill.totalAmount,
      fromSubmissionId: submission.id,
      discountIdChecked,
    });

    const settled = await paymentSubmissionRepository.settle(id, {
      status: 'Verified',
      reviewedBy: actor.userId,
      reviewNote: null,
      paymentId: payment.id,
    });
    if (!settled) {
      // Another cashier settled it between the read and the write. The payment above already
      // happened, so this is reported rather than silently swallowed.
      const error = new Error('Another cashier reviewed this submission first. Check the visit before retrying.');
      error.statusCode = 409;
      throw error;
    }

    await auditService.log({
      actorId: actor.userId,
      action: 'payment_submission.verified',
      entityType: 'payment_submission',
      entityId: settled.id,
      description: `Ref ${settled.reference_number} verified — receipt ${payment.receipt_number}`,
    });

    // Told, rather than left to notice. The patient portal has no notification bell, so email is
    // the only channel that reaches them — and they are waiting on something only the clinic can
    // do, which is exactly the situation where silence gets read as "it did not work".
    //
    // After the settle, never inside it, and never awaited in a way that can fail the approval:
    // the money is taken and the receipt exists by this point, so an SMTP problem must not turn a
    // completed payment into an error the cashier has to interpret.
    await this.notifyPatient(settled.id, { verified: true, payment }).catch(() => {});

    return { submission: settled, payment };
  }

  /** Turn a claim down. A reason is required — the patient will ask. */
  async reject(id, reviewNote, actor, { removeDiscount = false } = {}) {
    if (!reviewNote?.trim()) {
      const error = new Error('Say why it was rejected — the patient is told this, and will ask.');
      error.statusCode = 400;
      throw error;
    }

    const submission = await paymentSubmissionRepository.findById(id);
    if (!submission) {
      const error = new Error('Payment submission not found.');
      error.statusCode = 404;
      throw error;
    }
    if (submission.status !== 'Pending') {
      const error = new Error(`This submission was already ${submission.status.toLowerCase()}.`);
      error.statusCode = 409;
      throw error;
    }

    const settled = await paymentSubmissionRepository.settle(id, {
      status: 'Rejected',
      reviewedBy: actor.userId,
      reviewNote: reviewNote.trim(),
      paymentId: null,
    });
    if (!settled) {
      const error = new Error('Another cashier reviewed this submission first.');
      error.statusCode = 409;
      throw error;
    }

    await auditService.log({
      actorId: actor.userId,
      action: 'payment_submission.rejected',
      entityType: 'payment_submission',
      entityId: settled.id,
      description: `Ref ${settled.reference_number} rejected — ${settled.review_note}`,
    });

    // [1.146.0] A Senior Citizen / PWD discount declared online whose ID was not valid comes off
    // with the rejection, so the patient's next payment is for the full amount the portal states.
    if (removeDiscount) {
      await discountService.clearFromVisit(settled.patient_visit_id, actor, { afterRejectingProof: true })
        .catch((err) => logger.error(`Could not remove the declared discount: ${err.message}`));
    }

    // The reason is the whole point of requiring one. Sending it is what stops the patient
    // refreshing the portal, guessing, and eventually ringing the clinic.
    // The patient gets the payment window again to send a proof that can be accepted. [1.123.0]
    // [1.145.0] That window ends at the appointment, so a proof turned down after it leaves no time.
    const held = await appointmentRepository.reholdForPayment(settled.patient_visit_id).catch(() => null);
    // Read before anything is removed: the email needs the patient's address and reference.
    const contact = await paymentSubmissionRepository.findByIdWithContact(settled.id).catch(() => null);
    const released = Boolean(held?.held_until) && new Date(held.held_until) <= new Date();

    // [1.146.0] Its time has passed, so the booking is released now rather than at the next sweep,
    // which would email the patient a second time. The proof stays on record (Activity Log).
    if (released) {
      const booking = await visitRepository.findUnpaidBooking({ visitId: settled.patient_visit_id });
      if (booking && !booking.paid) {
        await unpaidExpiryService.removeNow(booking, { why: 'proof_rejected_late', actorId: actor.userId })
          .catch((err) => logger.error(`Could not release booking after a late rejection: ${err.message}`));
      }
    }

    await this.notifyPatient(settled.id, { verified: false, contact, payBy: held?.held_until || null, released }).catch(() => {});

    return { ...settled, released, payBy: held?.held_until || null };
  }

  /**
   * Write to the patient about a decision on their payment.
   *
   * Never throws. Every caller invokes it after the decision has committed, so a missing SMTP
   * config or a bounced address must not surface as a failure on a payment that already happened
   * — `sendEmail` already swallows transport errors, and this adds the same guarantee around the
   * lookup.
   */
  async notifyPatient(submissionId, { verified, payment, contact = null, payBy = null, released = false }) {
    try {
      const s = contact || await paymentSubmissionRepository.findByIdWithContact(submissionId);
      if (!s || !s.patient_email) return { skipped: true };

      const patientName = `${s.first_name} ${s.last_name}`;
      if (verified) {
        return await appointmentEmailService.sendPaymentVerified({
          to: s.patient_email,
          patientName,
          reference: s.appointment_reference,
          receiptNumber: payment?.receipt_number,
          amount: formatCurrency(payment?.amount),
        });
      }
      return await appointmentEmailService.sendPaymentRejected({
        to: s.patient_email,
        patientName,
        reference: s.appointment_reference,
        reason: s.review_note,
        payBy,
        released,
      });
    } catch (err) {
      // Logged rather than raised: the decision stands either way, and losing the email must not
      // make a settled payment look broken.
      logger.error('Failed to email the patient about their payment decision:', err);
      return { error: err.message };
    }
  }

  /**
   * The uploaded screenshot, for the authorised read-back route.
   *
   * This is a patient's bank or e-wallet screen: it carries their name, their balance in some
   * apps, and their transaction history. Streamed through an authenticated, ownership-checked
   * route for the same reason HMO cards are, and never served statically.
   */
  async getProofFile(id, user) {
    const submission = await paymentSubmissionRepository.findById(id);
    if (!submission || !submission.proof_file_path) {
      const error = new Error('No proof of payment on this submission.');
      error.statusCode = 404;
      throw error;
    }
    // Staff who may read billing see any; a client sees only their own.
    await this.assertClientOwnsVisit(user, submission.patient_visit_id);

    const absolute = path.join(PAYMENT_UPLOAD_ROOT, path.basename(submission.proof_file_path));
    if (!fs.existsSync(absolute)) {
      const error = new Error('The proof file is missing from storage.');
      error.statusCode = 404;
      throw error;
    }
    return { absolute, mimeType: submission.proof_mime_type };
  }
}

module.exports = new PaymentSubmissionService();
