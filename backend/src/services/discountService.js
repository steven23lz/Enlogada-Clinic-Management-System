const discountRepository = require('../repositories/discountRepository');
const env = require('../config/environment');
const visitRepository = require('../repositories/visitRepository');
const paymentRepository = require('../repositories/paymentRepository');
const auditService = require('./auditService');

/**
 * Rounds to centavos, half-up.
 *
 * Money is NUMERIC(10,2) in the database, so a discount has to land on a real centavo before it
 * is stored or compared. Doing this once, here, keeps the cashier's screen, the authoritative
 * server-side total and the stored receipt agreeing to the last centavo — processPayment rejects
 * a submitted amount that differs by more than ₱0.01, so a rounding disagreement between those
 * three would show up as a payment the cashier cannot complete.
 */
const toCentavos = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

class DiscountService {
  async getCatalogue({ includeInactive = false } = {}) {
    return await discountRepository.findAll({ includeInactive });
  }

  /**
   * Breaks a visit's payable amount into VAT, discount and the balance due.
   *
   * The starting figure is the patient's own out-of-pocket amount — subtotal minus whatever the
   * HMO has actually approved — not the gross subtotal. A discount reduces what the *patient*
   * pays; applying it to amounts an insurer is settling would discount somebody else's money and
   * understate the receivable from the HMO.
   *
   * VAT, for a STATUTORY discount at a VAT-registered establishment:
   *
   *     VAT-inclusive price          1,000.00
   *     less 12% VAT                  -107.14    (price - price/1.12)
   *     ------------------------------------
   *     VAT-exempt sale                892.86
   *     less 20% discount             -178.57    (20% of the VAT-EXEMPT base, not of the price)
   *     ------------------------------------
   *     Amount due                     714.29
   *
   * The order is fixed by RA 9994 / RA 10754 and is not the intuitive one. A flat 20% off the
   * price gives 800.00, which overcharges the patient by 85.71 per 1,000 and understates the
   * deduction the clinic can claim; discounting first would also charge a VAT-exempt patient VAT
   * on part of the sale. `tests.price` is stored VAT-INCLUSIVE — it is the shelf price a patient
   * is quoted — so the VAT is extracted from it rather than added on top.
   *
   * Only statutory discounts are VAT-exempt. A promo or corporate rate is an ordinary discount on
   * a VAT-inclusive price, which is why `isStatutory` drives the branch and not the percentage.
   *
   * Each figure is rounded to centavos and the balance is derived from the rounded parts, so
   * `netDue + discountAmount + vatDeducted` always equals `gross` exactly. That matters because
   * processPayment rejects a submitted amount differing by more than a centavo — an arithmetic
   * disagreement here surfaces as a payment the cashier cannot complete.
   */
  computeBreakdown({ subtotal, hmoCoverage, percentage, isStatutory }) {
    const gross = toCentavos(Math.max(0, Number(subtotal) - Number(hmoCoverage)));
    const pct = Number(percentage) || 0;

    if (pct <= 0) {
      return { gross, vatDeducted: 0, discountBase: gross, discountAmount: 0, netDue: gross };
    }

    const vatDeducted =
      isStatutory && env.CLINIC_VAT_REGISTERED
        ? toCentavos(gross - gross / (1 + env.VAT_RATE))
        : 0;
    const discountBase = toCentavos(gross - vatDeducted);
    const discountAmount = toCentavos((discountBase * pct) / 100);
    const netDue = toCentavos(discountBase - discountAmount);

    return { gross, vatDeducted, discountBase, discountAmount, netDue };
  }

  async applyToVisit(visitId, { discountTypeId, idNumber }, requestingUser) {
    const visit = await visitRepository.findVisitById(visitId);
    if (!visit) {
      const error = new Error('Visit not found');
      error.statusCode = 404;
      throw error;
    }

    // Once money has changed hands the bill is settled. Changing the discount afterwards would
    // silently disagree with the receipt already issued and with the statutory register, and
    // there is no re-bill path to reconcile it — a correction has to go through the existing
    // refund flow instead.
    const alreadyPaid = await paymentRepository.hasPaidPayment(visitId);
    if (alreadyPaid) {
      const error = new Error(
        'This visit has already been paid. Refund the payment first if the discount needs to change.'
      );
      error.statusCode = 409;
      throw error;
    }

    const discount = await discountRepository.findById(discountTypeId);
    if (!discount) {
      const error = new Error('Unknown discount type.');
      error.statusCode = 400;
      throw error;
    }
    if (!discount.is_active) {
      const error = new Error(`The "${discount.name}" discount is not currently active.`);
      error.statusCode = 400;
      throw error;
    }

    // The ID number is the evidence that the entitlement was checked. Without it a statutory
    // discount is an unsupported deduction, which is precisely what an audit looks for.
    const trimmedId = (idNumber || '').trim();
    if (discount.requires_id && !trimmedId) {
      const error = new Error(
        `A ${discount.name} discount requires the holder's ID number (OSCA/PWD ID) to be recorded.`
      );
      error.statusCode = 400;
      throw error;
    }

    const applied = await discountRepository.applyToVisit(visitId, {
      discountTypeId,
      idNumber: trimmedId,
      grantedBy: requestingUser?.userId,
    });

    // Audit-logged like the other money-affecting actions (refunds, HMO approvals): a deduction
    // that reduces what the clinic collects should name who authorised it.
    await auditService.log({
      actorId: requestingUser?.userId,
      action: 'discount.applied',
      entityType: 'patient_visit',
      entityId: visitId,
      description: `Applied ${discount.name} (${discount.percentage}%) to visit #${visitId}${
        trimmedId ? `, ID ${trimmedId}` : ''
      }`,
    });

    return applied;
  }

  async clearFromVisit(visitId, requestingUser) {
    const visit = await visitRepository.findVisitById(visitId);
    if (!visit) {
      const error = new Error('Visit not found');
      error.statusCode = 404;
      throw error;
    }

    const alreadyPaid = await paymentRepository.hasPaidPayment(visitId);
    if (alreadyPaid) {
      const error = new Error(
        'This visit has already been paid. Refund the payment first if the discount needs to change.'
      );
      error.statusCode = 409;
      throw error;
    }

    const cleared = await discountRepository.clearFromVisit(visitId);

    await auditService.log({
      actorId: requestingUser?.userId,
      action: 'discount.removed',
      entityType: 'patient_visit',
      entityId: visitId,
      description: `Removed the discount from visit #${visitId}`,
    });

    return cleared;
  }

  /**
   * The statutory discount register for a date range, plus its totals — the summary an accountant
   * files rather than a raw row dump.
   */
  async getStatutoryRegister({ startDate, endDate }) {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await discountRepository.findStatutoryRegister({
      startDate: startDate || today,
      endDate: endDate || today,
    });

    // Reversals are shown but excluded from the totals: a refunded sale is not a discount the
    // clinic actually granted, and counting it would overstate the deduction claimed.
    const settled = rows.filter((r) => r.payment_status === 'Paid');
    const sum = (list, key) => list.reduce((acc, r) => acc + parseFloat(r[key] || 0), 0);

    const byType = {};
    for (const row of settled) {
      const key = row.discount_type_name;
      byType[key] = byType[key] || { discountType: key, count: 0, discountTotal: 0, grossTotal: 0 };
      byType[key].count += 1;
      byType[key].discountTotal = toCentavos(byType[key].discountTotal + parseFloat(row.discount_amount || 0));
      byType[key].grossTotal = toCentavos(byType[key].grossTotal + parseFloat(row.gross_amount || 0));
    }

    return {
      startDate: startDate || today,
      endDate: endDate || today,
      entries: rows,
      summary: {
        transactionCount: settled.length,
        reversedCount: rows.length - settled.length,
        grossTotal: toCentavos(sum(settled, 'gross_amount')).toFixed(2),
        // The two figures BIR actually asks for on a senior/PWD register: what the sale was
        // after VAT was removed, and how much VAT was therefore not collected.
        vatExemptSalesTotal: toCentavos(sum(settled, 'vat_exempt_sale')).toFixed(2),
        vatTotal: toCentavos(sum(settled, 'vat_amount')).toFixed(2),
        discountTotal: toCentavos(sum(settled, 'discount_amount')).toFixed(2),
        netTotal: toCentavos(sum(settled, 'amount_paid')).toFixed(2),
        byType: Object.values(byType).map((t) => ({
          ...t,
          discountTotal: t.discountTotal.toFixed(2),
          grossTotal: t.grossTotal.toFixed(2),
        })),
      },
    };
  }
}

module.exports = new DiscountService();
module.exports.toCentavos = toCentavos;
