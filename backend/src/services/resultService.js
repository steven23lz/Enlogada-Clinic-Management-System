const fs = require('fs');
const path = require('path');
const resultRepository = require('../repositories/resultRepository');
const testRepository = require('../repositories/testRepository');
const { sendEmail } = require('../config/email');
const notificationService = require('./notificationService');
const { UPLOAD_ROOT } = require('../config/upload');
const auditService = require('./auditService');

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

  async getReleasedByCategory(categoryName, requestingUser) {
    const validCategories = ['Laboratory', 'Xray', 'Ultrasound', '2D Echo'];
    if (!validCategories.includes(categoryName)) {
      const error = new Error(`Invalid category. Must be one of: ${validCategories.join(', ')}`);
      error.statusCode = 400;
      throw error;
    }
    assertStaffAllowedCategory(requestingUser, categoryName);
    return await resultRepository.findReleasedByCategory(categoryName);
  }

  async updateTestStatus(visitTestId, status, requestingUser) {
    await assertStaffOwnsVisitTest(requestingUser, visitTestId);
    return await testRepository.updateVisitTestStatus(visitTestId, status);
  }

  async uploadResult({ visitTestId, fileUrl, file, findings, remarks, releasedBy }, requestingUser) {
    await assertStaffOwnsVisitTest(requestingUser, visitTestId);

    // Fetched once, up front: doubles as (a) the file-preservation source when neither a new
    // file nor fileUrl is provided, and (b) the correction signal below — a result already
    // existing before this call means this is an edit, not a first-time release.
    const existing = await resultRepository.findResultByVisitTestId(visitTestId);
    const isCorrection = !!existing;

    // Mark the visit_test as Completed
    await testRepository.updateVisitTestStatus(visitTestId, 'Completed');

    // Phase B: a real uploaded file (via multer) takes precedence over the legacy fileUrl text
    // field — both can't meaningfully apply at once, and the frontend only ever sends one or
    // the other.
    let resolvedFileUrl = fileUrl || null;
    let filePath = null, fileOriginalName = null, fileMimeType = null, fileSizeBytes = null;

    if (file) {
      filePath = path.relative(UPLOAD_ROOT, file.path);
      fileOriginalName = file.originalname;
      fileMimeType = file.mimetype;
      fileSizeBytes = file.size;
      resolvedFileUrl = null;
    } else if (!fileUrl && existing) {
      // Phase C: this call now also handles correcting an already-released result (editing
      // findings/remarks without re-attaching a file) — without this, re-submitting would
      // silently wipe a previously uploaded file's metadata, since createResult's upsert
      // otherwise overwrites every column unconditionally.
      filePath = existing.file_path;
      fileOriginalName = existing.file_original_name;
      fileMimeType = existing.file_mime_type;
      fileSizeBytes = existing.file_size_bytes;
      resolvedFileUrl = existing.file_url;
    }

    const result = await resultRepository.createResult({
      visitTestId,
      fileUrl: resolvedFileUrl,
      filePath,
      fileOriginalName,
      fileMimeType,
      fileSizeBytes,
      findings,
      remarks,
      releasedBy
    });

    // Phase D: only a correction is audit-worthy here — the first-time release of every result
    // would make the log mostly noise from routine work, not the "something changed after the
    // fact" signal an audit trail is for.
    if (isCorrection) {
      await auditService.log({
        actorId: requestingUser?.userId,
        action: 'result.corrected',
        entityType: 'test_result',
        entityId: result.id,
        description: `Corrected findings for visit test #${visitTestId}`
      });
    }

    return result;
  }

  // Phase B: streams the physical file back for a result — never through a public static path,
  // since these are PHI. Ownership mirrors the two checks already used elsewhere in this file/
  // resultController: staff must own the test's category (assertStaffOwnsVisitTest, SuperAdmin/
  // Admin bypass); a Client must own the patient the test belongs to (getPatientHistory's check).
  async getResultFile(visitTestId, requestingUser) {
    const ownership = await resultRepository.findOwnershipInfoByVisitTestId(visitTestId);
    if (!ownership) {
      const error = new Error('Visit test not found.');
      error.statusCode = 404;
      throw error;
    }

    if (requestingUser.roles.includes('Client')) {
      if (ownership.patient_user_id !== requestingUser.userId) {
        const error = new Error('Access forbidden. This result does not belong to your account.');
        error.statusCode = 403;
        throw error;
      }
    } else {
      assertStaffAllowedCategory(requestingUser, ownership.category_name);
    }

    const result = await resultRepository.findResultByVisitTestId(visitTestId);
    if (!result || !result.file_path) {
      const error = new Error('No uploaded file exists for this result.');
      error.statusCode = 404;
      throw error;
    }

    const absolutePath = path.join(UPLOAD_ROOT, result.file_path);
    if (!fs.existsSync(absolutePath)) {
      const error = new Error('The file for this result could not be found on the server.');
      error.statusCode = 404;
      throw error;
    }

    return {
      absolutePath,
      originalName: result.file_original_name || 'result',
      mimeType: result.file_mime_type || 'application/octet-stream'
    };
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

    // Module 18 (Notification): Admin/SuperAdmin oversight of diagnostic throughput, matching
    // the existing Reports/oversight theme — not the releasing staff member themselves, who is
    // the actor here, not a recipient.
    if (patientInfo) {
      await notificationService.notifyRoles(['Admin', 'SuperAdmin'], {
        title: 'Result Released',
        message: `${patientInfo.test_name} for ${patientInfo.first_name} ${patientInfo.last_name}`,
        type: 'success'
      });
    }

    return result;
  }

  async getPatientHistory(patientId) {
    return await resultRepository.findResultsByPatientId(patientId);
  }
}

module.exports = new ResultService();
