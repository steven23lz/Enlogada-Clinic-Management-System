const resultRepository = require('../repositories/resultRepository');
const testRepository = require('../repositories/testRepository');
const visitRepository = require('../repositories/visitRepository');
const { sendEmail } = require('../config/email');
const notificationService = require('./notificationService');
const {
  STAFF_ROLE_TO_CATEGORIES: STAFF_CATEGORY_MAP,
  DIAGNOSTIC_CATEGORIES,
  MODALITY_SETTABLE_TEST_STATUSES
} = require('../constants/modality');

// resultController's routes authorize "is this caller some kind of diagnostic staff," not
// "does this visit_test's category match their department" — confirmed live that a Laboratory
// Staff account could call e.g. POST /results/:visitTestId/release on an Xray test with no
// pushback (escalated from Module 9, see TRACEABILITY.md). This closes that gap the same way
// Client ownership is enforced elsewhere in the app: a private guard inside the service layer,
// not just client-side UI routing. SuperAdmin/Admin bypass, matching the RBAC convention used
// everywhere else (they oversee all departments).
function assertStaffAllowedCategory(requestingUser, categoryName) {
  if (requestingUser.roles.includes('SuperAdmin') || requestingUser.roles.includes('Admin')) {
    return;
  }
  const allowed = new Set();
  for (const role of requestingUser.roles) {
    (STAFF_CATEGORY_MAP[role] || []).forEach((c) => allowed.add(c));
  }
  if (!allowed.has(categoryName)) {
    const error = new Error('You are not authorized to act on this test category.');
    error.statusCode = 403;
    throw error;
  }
}

// Category ownership is only half the question. The other half — added with the ticket-release
// gating work — is whether this ticket was ever released to the modalities at all. Filtering
// findPendingByCategory on the parent visit hides un-released tickets from the worklist UI, but
// hiding is not enforcing: a visit_test id is a small integer, and any diagnostic staff token
// could previously act on one that the receptionist/cashier had not yet handed over. Both
// checks run for every state-changing modality operation.
async function assertStaffOwnsVisitTest(requestingUser, visitTestId) {
  if (requestingUser.roles.includes('SuperAdmin') || requestingUser.roles.includes('Admin')) {
    return;
  }
  const row = await resultRepository.findVisitReleaseStateByVisitTestId(visitTestId);
  if (!row) {
    const error = new Error('Visit test not found.');
    error.statusCode = 404;
    throw error;
  }
  assertStaffAllowedCategory(requestingUser, row.category_name);

  if (row.visit_status !== 'Processing') {
    const error = new Error(
      'This ticket has not been released to your department yet. It is still with the front desk or cashier.'
    );
    error.statusCode = 403;
    throw error;
  }
}

class ResultService {
  async getPendingByCategory(categoryName, requestingUser) {
    // '2D Echo' is its own row in test_categories, distinct from 'Ultrasound', but
    // MODULE_SCOPE.md explicitly assigns it to the Ultrasound Staff role ("Ultrasound-category
    // (including 2D Echo)") — so it must be independently queryable here even though no staff
    // role is named after it directly.
    if (!DIAGNOSTIC_CATEGORIES.includes(categoryName)) {
      const error = new Error(`Invalid category. Must be one of: ${DIAGNOSTIC_CATEGORIES.join(', ')}`);
      error.statusCode = 400;
      throw error;
    }
    assertStaffAllowedCategory(requestingUser, categoryName);
    return await resultRepository.findPendingByCategory(categoryName);
  }

  async getReleasedByCategory(categoryName, requestingUser) {
    if (!DIAGNOSTIC_CATEGORIES.includes(categoryName)) {
      const error = new Error(`Invalid category. Must be one of: ${DIAGNOSTIC_CATEGORIES.join(', ')}`);
      error.statusCode = 400;
      throw error;
    }
    assertStaffAllowedCategory(requestingUser, categoryName);
    return await resultRepository.findReleasedByCategory(categoryName);
  }

  // A modality may move its own ticket to 'Waiting for Release' (exam done, findings pending
  // authorisation) or 'Completed'. It may NOT set 'Processing': a ticket arrives already
  // Processing, put there by the release. That is what "modality staff cannot start a process
  // on their own" means in enforcement terms.
  async updateTestStatus(visitTestId, status, requestingUser) {
    await assertStaffOwnsVisitTest(requestingUser, visitTestId);

    const isPrivileged =
      requestingUser.roles.includes('SuperAdmin') || requestingUser.roles.includes('Admin');
    if (!isPrivileged && !MODALITY_SETTABLE_TEST_STATUSES.includes(status)) {
      const error = new Error(
        `Diagnostic staff may only set a ticket to: ${MODALITY_SETTABLE_TEST_STATUSES.join(' or ')}.`
      );
      error.statusCode = 403;
      throw error;
    }

    return await testRepository.updateVisitTestStatus(visitTestId, status);
  }

  async uploadResult({ visitTestId, fileUrl, findings, remarks, releasedBy }, requestingUser) {
    await assertStaffOwnsVisitTest(requestingUser, visitTestId);

    // Recording findings is not the same event as releasing them. The ticket parks in
    // 'Waiting for Release' — visible as such to the front desk — until releaseResult below
    // authorises it and notifies the patient.
    await testRepository.updateVisitTestStatus(visitTestId, 'Waiting for Release');

    // Create the result record
    const result = await resultRepository.createResult({
      visitTestId,
      fileUrl,
      findings,
      remarks,
      releasedBy
    });

    return result;
  }

  async releaseResult({ visitTestId, releasedBy }, requestingUser) {
    await assertStaffOwnsVisitTest(requestingUser, visitTestId);

    // Fetch result to confirm it exists
    const result = await resultRepository.findResultByVisitTestId(visitTestId);
    if (!result) {
      const error = new Error('No result found for this visit test. Please upload findings first.');
      error.statusCode = 400;
      throw error;
    }

    // Releasing is the step that completes the ticket. Reading the visit id before the update
    // (rather than after) keeps the "was this the last test?" check below working even if the
    // row shape changes later.
    const releaseState = await resultRepository.findVisitReleaseStateByVisitTestId(visitTestId);
    await testRepository.updateVisitTestStatus(visitTestId, 'Completed');

    // Once nothing on the visit is outstanding, the visit itself is done — otherwise it would
    // sit in 'Processing' forever, permanently inflating the front desk's active queue and the
    // cashier's billing list.
    if (releaseState && !(await visitRepository.hasOutstandingTests(releaseState.visit_id))) {
      await visitRepository.updateVisitStatus(releaseState.visit_id, 'Completed');
    }

    // Attempt to send email notification to patient
    const patientInfo = await resultRepository.findPatientEmailByVisitTestId(visitTestId);
    if (patientInfo && patientInfo.email) {
      await sendEmail({
        to: patientInfo.email,
        subject: `Your ${patientInfo.test_name} Results Are Ready - Enlogada Clinic`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Hello ${patientInfo.first_name} ${patientInfo.last_name},</h2>
            <p>Your <strong>${patientInfo.test_name}</strong> results are now available.</p>
            <p>You can view your results by logging in to your account or by visiting the clinic.</p>
            <br/>
            <p>Thank you,</p>
            <p><strong>Enlogada Ultrasound and Diagnostic Clinic</strong></p>
          </div>
        `
      });
    }

    // Module 18 (Notification): Admin/SuperAdmin oversight of diagnostic throughput, matching
    // the existing Reports/oversight theme — not the releasing staff member themselves, who is
    // the actor here, not a recipient.
    // Receptionist is included alongside the Admin/SuperAdmin oversight audience: the front
    // desk owns the queue board, and a ticket finishing at a modality is exactly the kind of
    // modality-side change that has to reflect back to reception.
    if (patientInfo) {
      await notificationService.notifyRoles(['Receptionist', 'Admin', 'SuperAdmin'], {
        title: 'Result Released',
        message: `${patientInfo.test_name} for ${patientInfo.first_name} ${patientInfo.last_name}`,
        type: 'success'
      });
    }

    return result;
  }

  // Lets the modality re-open a ticket that is already 'Waiting for Release' and edit the
  // findings it recorded earlier, instead of overwriting them with a blank form.
  async getResultByVisitTestId(visitTestId, requestingUser) {
    await assertStaffOwnsVisitTest(requestingUser, visitTestId);
    return await resultRepository.findResultByVisitTestId(visitTestId);
  }

  async getPatientHistory(patientId) {
    return await resultRepository.findResultsByPatientId(patientId);
  }
}

module.exports = new ResultService();
