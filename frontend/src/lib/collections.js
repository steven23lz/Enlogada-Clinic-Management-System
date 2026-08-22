import { toDateInput } from './date';

/**
 * Which rows in a transaction list are money.
 *
 * `GET /payments/transactions` lists every receipt the clinic issued, including ones later
 * reversed — that is the point of a cash-up log, and the screens say so: "refunds and
 * cancellations are recorded against the original receipt".
 *
 * Prefer the `summary` the endpoint returns over anything in this file: it is computed in SQL
 * across the whole date range, so it is right on a paged response too, where the rows in hand are
 * one page and reducing them would total that page and label it the day. Reach for `settled()`
 * only for a breakdown the summary does not carry — grouping by cashier, or by payment method —
 * and only on an unpaged fetch.
 *
 * WHICH ROWS COUNT DEPENDS ON THE RANGE, which is why the server now answers it per row.
 *
 * Under the period cash book [1.30.0], `collected` is money taken IN during the range, bucketed
 * by `paid_at` and counted whatever happens to the receipt afterwards. So `payment_status ===
 * 'Paid'` — what this used to test — is now wrong in both directions at once:
 *
 *   a receipt taken in range and later reversed IS in `collected`, but reads as 'Refunded'
 *   a receipt taken last week and reversed in range is NOT, but is listed and reads as 'Refunded'
 *
 * The list matches the range on either date, so both rows are present. Getting this wrong made
 * the per-cashier cards on Cashier Monitoring and the method breakdown on Reports sum to
 * `collected - reversed` while a card in the same grid showed `collected` — a contradiction
 * inches apart, with neither number labelled as the other's complement.
 *
 * `counted_in_collected` carries the range predicate that only the query knows. The
 * `payment_status` fallback is for the other endpoints that return payment rows without it — a
 * patient's own history, a visit's payments — none of which sums across a date range.
 */
export const isSettled = (transaction) => (
  typeof transaction?.counted_in_collected === 'boolean'
    ? transaction.counted_in_collected
    : transaction?.payment_status === 'Paid'
);

export const settled = (transactions) => (transactions || []).filter(isSettled);

/**
 * Was this receipt reversed on a different day than it was taken? [1.30.0]
 *
 * The case the cash-up could not represent at all before `refunded_at` existed, and the only one
 * that needs explaining on screen. A same-day reversal is self-evident — the receipt and its
 * reversal sit in the same day's figures, money in and money out. A cross-day one is why a
 * reversal can appear in today's log against a receipt today's takings never counted.
 *
 * Compared as LOCAL calendar days, because that is the unit the cash-up files them under and the
 * server's CURRENT_DATE is a local date. Local getters via toDateInput rather than toISOString,
 * per the rule at the top of lib/date.js: the API serialises a timestamp as a UTC instant, so UTC
 * getters put anything after 4pm Manila on the following day.
 */
export const isCrossDayReversal = (transaction) => {
  if (!transaction?.refunded_at || !transaction?.paid_at) return false;
  const taken = new Date(transaction.paid_at);
  const reversed = new Date(transaction.refunded_at);
  if (Number.isNaN(taken.getTime()) || Number.isNaN(reversed.getTime())) return false;
  return toDateInput(taken) !== toDateInput(reversed);
};
