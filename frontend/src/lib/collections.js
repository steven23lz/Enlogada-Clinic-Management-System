/**
 * Which rows in a transaction list are money.
 *
 * `GET /payments/transactions` lists every receipt the clinic issued, including ones later
 * reversed — that is the point of a cash-up log, and the screens say so: "refunds and
 * cancellations are recorded against the original receipt". A reversed row is therefore present
 * and must not be added up.
 *
 * Prefer the `summary` the endpoint returns over anything in this file: it is computed in SQL
 * across the whole date range, so it is right on a paged response too, where the rows in hand are
 * one page and reducing them would total that page and label it the day. Reach for `settled()`
 * only for a breakdown the summary does not carry — grouping by cashier, or by payment method —
 * and only on an unpaged fetch.
 */
export const isSettled = (transaction) => transaction?.payment_status === 'Paid';

export const settled = (transactions) => (transactions || []).filter(isSettled);
