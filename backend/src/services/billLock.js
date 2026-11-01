const paymentSubmissionRepository = require('../repositories/paymentSubmissionRepository');

/**
 * A bill the patient has already paid online, waiting for a cashier, cannot change under them.
 * [1.146.0]
 *
 * A patient sends the amount the portal stated; approving the proof records the bill as it stands
 * then. A discount applied, or a test added or removed, in between made the two differ: a senior
 * discount given after a full-price transfer recorded less than the patient sent, a test added
 * recorded more, and with no refunds [1.121.0] neither could be put right. So the bill stays as the
 * patient paid it until the proof is verified or rejected. Rejecting first is the way to change it.
 *
 * @param {number} visitId
 * @param {string} what  what cannot change, as it finishes the sentence: "its discount", "its tests"
 */
async function assertNoProofWaiting(visitId, what) {
  const proof = await paymentSubmissionRepository.findPendingForVisit(visitId);
  if (proof) {
    const error = new Error(
      `The patient has sent an online payment for this visit (ref ${proof.reference_number}), waiting to be checked on Online Payments, so ${what} cannot change. Verify or reject that payment first.`
    );
    error.statusCode = 409;
    throw error;
  }
}

module.exports = { assertNoProofWaiting };
