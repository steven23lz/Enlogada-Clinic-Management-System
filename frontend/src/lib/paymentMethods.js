/**
 * The payment methods a cashier can record at the counter. [1.33.0]
 *
 * Mirrors `backend/src/constants/paymentMethods.js` — COUNTER_METHODS there, same order. Change
 * one and change the other; the backend list is the authority, because `chk_payment_method` is
 * built from it and is what actually rejects a bad value.
 *
 * Two lists rather than one endpoint is a deliberate trade. Fetching the vocabulary would make
 * the till's buttons depend on a network round trip to render, on the busiest screen in the
 * clinic, to avoid duplicating four short strings. The database constraint already catches a
 * disagreement — a method this file offers and the backend does not is rejected at INSERT rather
 * than silently recorded — so drift is loud rather than quiet.
 *
 * PayMaya was removed in [1.33.0]: the clinic owner holds no PayMaya merchant account, so it was
 * a way to pay that nobody could settle. Putting it back is one string here, one in the backend
 * constant, and `node src/scripts/migratePaymentMethods.js --rollback`.
 *
 * ONLINE methods are NOT this list. Those come from `GET /payments/gateway/status` and are
 * rendered from the response — see AppointmentsTab — because whether a gateway is configured at
 * all is a runtime fact this file cannot know.
 */
export const COUNTER_PAYMENT_METHODS = ['Cash', 'GCash', 'Bank'];

/**
 * The same list plus an "All" entry, for filtering rather than choosing.
 *
 * 'All' is a UI value and never a payment_method — it means "do not filter", and callers must
 * send no method rather than sending the string.
 */
export const METHOD_FILTER_ALL = 'All';

export const METHOD_FILTERS = [METHOD_FILTER_ALL, ...COUNTER_PAYMENT_METHODS];
