/**
 * Which day a peso belongs to. One definition, because two disagreed. [1.30.0]
 *
 * The cash book [1.30.0] introduced lives in `paymentRepository.findTransactionSummary`, and
 * `reportRepository` was left on the old basis — so the cashier's strip and the operations
 * report's "Takings" panel answered the same question differently. For one ₱550 receipt paid and
 * reversed on the same day, the strip said ₱550 collected and the panel said ₱0.00. Worse, the
 * report still bucketed reversals by `paid_at`, so the regression [1.30.0] is named for — a
 * closed day quietly restating — survived intact in the half that gets PRINTED.
 *
 * Two predicates, and the model is a period cash book rather than a running balance:
 *
 *   ISSUED_IN_RANGE    money taken IN during the range, bucketed by `paid_at` and counted
 *                      whatever happens to the receipt afterwards. Deliberately does NOT test
 *                      `payment_status`: a receipt issued on the 19th was money on the 19th, and
 *                      dropping it once reversed is exactly what restated closed days.
 *
 *   REVERSED_IN_RANGE  money handed BACK during the range, bucketed by the refund's own date.
 *                      [1.155.0] Read from `payment_refunds`: a receipt can be refunded in part, and
 *                      more than once, so one date and the receipt's whole amount cannot say it.
 *
 * `reversed` is reported beside `collected` and never subtracted from it, so a receipt paid and
 * refunded the same day reads as money in and money out rather than as nothing having happened —
 * which is what the drawer actually did. The net is `collected - reversed`.
 *
 * Take them as a pair. Applying one while leaving the other on `payment_status` is what produced
 * the divergence this module exists to end.
 *
 * Every fragment qualifies its columns as `pay.`, so callers must alias `payments` as `pay`.
 * `hasDates` selects the parameterised form, and callers using it must push $1/$2 FIRST because
 * these fragments hard-code those positions.
 *
 * Half-open ranges on raw columns throughout, never `col::date = …`: a B-tree cannot serve a
 * predicate on an expression, and this is the table that grows fastest. See CLAUDE.md.
 */

const inRange = (hasDates) => (col) => (hasDates
  ? `pay.${col} >= $1::date AND pay.${col} < ($2::date + 1)`
  : `pay.${col} >= CURRENT_DATE AND pay.${col} < (CURRENT_DATE + 1)`);

const ISSUED_IN_RANGE = (hasDates) => inRange(hasDates)('paid_at');

/** The refunds in the range, as a condition on `payment_refunds r`. */
const REFUND_IN_RANGE = (hasDates) => (hasDates
  ? `r.refunded_at >= $1::date AND r.refunded_at < ($2::date + 1)`
  : `r.refunded_at >= CURRENT_DATE AND r.refunded_at < (CURRENT_DATE + 1)`);

/** This receipt had money handed back in the range. */
const REVERSED_IN_RANGE = (hasDates) =>
  `EXISTS (SELECT 1 FROM payment_refunds r WHERE r.payment_id = pay.id AND ${REFUND_IN_RANGE(hasDates)})`;

/**
 * The money handed back in the range, and how many times: `<amount>, <count>` for a SELECT list.
 * `via` narrows it to one way of going back, which is the drawer's question: a GCash payment refunded
 * in cash left the drawer. Give it as a parameter placeholder.
 */
const REVERSED_TOTALS = (hasDates, { via = null, amount = 'reversed', count = 'reversals' } = {}) => {
  const where = `${REFUND_IN_RANGE(hasDates)}${via ? ` AND r.returned_via = ${via}` : ''}`;
  return `(SELECT COALESCE(SUM(r.amount), 0)::numeric(12,2) FROM payment_refunds r WHERE ${where}) AS ${amount},
          (SELECT COUNT(*)::int FROM payment_refunds r WHERE ${where}) AS ${count}`;
};

/**
 * What a payment row carries about its refunds, for the receipt, the log and the patient. Callers alias
 * `payments` as `pay`.
 */
const REFUNDS_ON_PAYMENT = `
  (SELECT COALESCE(SUM(r.amount), 0)::numeric(12,2) FROM payment_refunds r WHERE r.payment_id = pay.id) AS refunded_amount,
  (SELECT COALESCE(json_agg(json_build_object(
            'id', r.id, 'amount', r.amount, 'kind', r.kind, 'reason', r.reason,
            'returnedVia', r.returned_via, 'reference', r.returned_reference, 'refundedAt', r.refunded_at,
            'tests', (SELECT COALESCE(json_agg(t.name ORDER BY t.name), '[]'::json)
                        FROM payment_refund_tests rt
                        JOIN visit_tests vt ON vt.id = rt.visit_test_id
                        JOIN tests t ON t.id = vt.test_id
                       WHERE rt.refund_id = r.id)
          ) ORDER BY r.refunded_at), '[]'::json)
     FROM payment_refunds r WHERE r.payment_id = pay.id) AS refunds`;

/**
 * A row that represents a receipt the clinic actually handed to a patient.
 *
 * `receipt_number IS NOT NULL` separates the two meanings of 'Cancelled': a gateway session
 * abandoned before payment (money never taken, never a receipt) from a settled receipt voided by
 * staff (a real reversal). The number is assigned on settlement and never before, so a row that
 * has one was, at some point, money. `paid_at` cannot make that distinction — it is
 * DEFAULT CURRENT_TIMESTAMP, so a 'Pending' row carries one too.
 *
 * Load-bearing anywhere a query counts non-'Paid' rows as reversals. `getBillingTotals` omitted
 * it and got away with it only because it also omitted 'Cancelled'; adding one without the other
 * makes abandoned checkouts report as refunds.
 */
const ISSUED_RECEIPT_CLAUSE = `
  pay.payment_status IN ('Paid', 'Refunded', 'Cancelled')
    AND pay.receipt_number IS NOT NULL
`;

/** The row set both sides are drawn from: taken in the range, or handed back in it. */
const MONEY_IN_RANGE = (hasDates) =>
  `((${ISSUED_IN_RANGE(hasDates)}) OR (${REVERSED_IN_RANGE(hasDates)}))`;

/**
 * The per-day form, for queries that GROUP BY day rather than totalling one range.
 *
 * A daily trend has no single closing date, and under a cash book it needs none: money in is
 * bucketed by `paid_at` and counted whatever happens later, so each day's bar is fixed the moment
 * that day ends. This is the predicate's whole content — the old `payment_status = 'Paid'` test
 * is what made a past day's bar shrink when a receipt from it was reversed weeks later.
 */
const ISSUED_IN_DAY_RANGE = `pay.paid_at >= $1::date AND pay.paid_at < ($2::date + 1)`;

module.exports = {
  ISSUED_IN_RANGE,
  REVERSED_IN_RANGE,
  ISSUED_IN_DAY_RANGE,
  MONEY_IN_RANGE,
  ISSUED_RECEIPT_CLAUSE,
  REVERSED_TOTALS,
  REFUNDS_ON_PAYMENT,
};
