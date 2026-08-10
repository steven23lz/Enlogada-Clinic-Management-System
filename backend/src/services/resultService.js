const resultRepository = require('../repositories/resultRepository');
const testRepository = require('../repositories/testRepository');
const { sendEmail } = require('../config/email');

// Which test_categories a given diagnostic staff role is allowed to act on. Ultrasound Staff
// covers '2D Echo' too — a distinct test_categories row that MODULE_SCOPE.md explicitly assigns
// to that role (matches the worklist merge already built in DiagnosticDashboard.jsx/Module 10).
const STAFF_CATEGORY_MAP = {
  'Laboratory Staff': ['Laboratory'],
  'Xray Staff': ['Xray'],
  'Ultrasound Staff': ['Ultrasound', '2D Echo'],
};

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

async function assertStaffOwnsVisitTest(requestingUser, visitTestId) {
  if (requestingUser.roles.includes('SuperAdmin') || requestingUser.roles.includes('Admin')) {
    return;
  }
  const row = await resultRepository.findVisitTestCategory(visitTestId);
  if (!row) {
    const error = new Error('Visit test not found.');
    error.statusCode = 404;
    throw error;
  }
  assertStaffAllowedCategory(requestingUser, row.category_name);
}

class ResultService {
  async getPendingByCategory(categoryName, requestingUser) {
    // '2D Echo' is its own row in test_categories, distinct from 'Ultrasound', but
    // MODULE_SCOPE.md explicitly assigns it to the Ultrasound Staff role ("Ultrasound-category
    // (including 2D Echo)") — so it must be independently queryable here even though no staff
    // role is named after it directly.
    const validCategories = ['Laboratory', 'Xray', 'Ultrasound', '2D Echo'];
    if (!validCategories.includes(categoryName)) {
      const error = new Error(`Invalid category. Must be one of: ${validCategories.join(', ')}`);
      error.statusCode = 400;
      throw error;
    }
    assertStaffAllowedCategory(requestingUser, categoryName);
    return await resultRepository.findPendingByCategory(categoryName);
  }

  async updateTestStatus(visitTestId, status, requestingUser) {
    await assertStaffOwnsVisitTest(requestingUser, visitTestId);
    return await testRepository.updateVisitTestStatus(visitTestId, status);
  }

  async uploadResult({ visitTestId, fileUrl, findings, remarks, releasedBy }, requestingUser) {
    await assertStaffOwnsVisitTest(requestingUser, visitTestId);

    // Mark the visit_test as Completed
    await testRepository.updateVisitTestStatus(visitTestId, 'Completed');

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

    return result;
  }

  async getPatientHistory(patientId) {
    return await resultRepository.findResultsByPatientId(patientId);
  }
}

module.exports = new ResultService();
