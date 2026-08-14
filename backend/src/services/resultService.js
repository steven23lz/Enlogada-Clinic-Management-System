const fs = require('fs');
const path = require('path');
const resultRepository = require('../repositories/resultRepository');
const testRepository = require('../repositories/testRepository');
const visitRepository = require('../repositories/visitRepository');
const db = require('../config/database');
const { sendEmail } = require('../config/email');
const notificationService = require('./notificationService');
const { UPLOAD_ROOT } = require('../config/upload');
const auditService = require('./auditService');
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

/**
 * The test categories this caller may see results for, or `null` for "no restriction".
 *
 * Unrestricted means something different for each role that gets it, and both are deliberate:
 * SuperAdmin/Admin oversee every department (the same bypass assertStaffAllowedCategory grants),
 * and a Client is restricted by *patient ownership* rather than by category — they are entitled to
 * all of their own results regardless of which department produced them, and that ownership check
 * runs in resultController before this is ever consulted.
 */
function visibleCategoriesFor(requestingUser) {
  const roles = requestingUser?.roles || [];
  if (roles.includes('SuperAdmin') || roles.includes('Admin') || roles.includes('Client')) {
    return null;
  }
  const allowed = new Set();
  for (const role of roles) {
    (STAFF_CATEGORY_MAP[role] || []).forEach((c) => allowed.add(c));
  }
  return [...allowed];
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

  async uploadResult({ visitTestId, fileUrl, file, findings, remarks, releasedBy }, requestingUser) {
    await assertStaffOwnsVisitTest(requestingUser, visitTestId);

    // Fetched once, up front: doubles as (a) the file-preservation source when neither a new
    // file nor fileUrl is provided, and (b) the correction signal below — a result already
    // existing before this call means this is an edit, not a first-time release.
    const existing = await resultRepository.findResultByVisitTestId(visitTestId);
    const isCorrection = !!existing;

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

    // Recording the findings and moving the ticket are one event.
    //
    // The status update used to run first, on its own, before createResult. If createResult then
    // failed, the ticket sat in 'Waiting for Release' — which the front desk reads as "findings
    // recorded, awaiting authorisation" — with no findings anywhere behind it. Releasing it then
    // fails with "No result found for this visit test", and nothing on any screen explains why a
    // ticket that says it is ready cannot be released.
    const result = await db.withTransaction(async () => {
      // Recording findings is not the same event as releasing them. The ticket parks in
      // 'Waiting for Release' — visible as such to the front desk — until releaseResult below
      // authorises it and notifies the patient.
      await testRepository.updateVisitTestStatus(visitTestId, 'Waiting for Release');

      const created = await resultRepository.createResult({
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
      //
      // Inside the transaction on purpose: an audit entry describing a correction that was then
      // rolled back is worse than no entry, because the log is the artifact whose whole value is
      // being trustworthy.
      if (isCorrection) {
        await auditService.log({
          actorId: requestingUser?.userId,
          action: 'result.corrected',
          entityType: 'test_result',
          entityId: created.id,
          description: `Corrected findings for visit test #${visitTestId}`
        });
      }

      return created;
    });

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

    // Releasing is the step that completes the ticket. Reading the visit id before the update
    // (rather than after) keeps the "was this the last test?" check below working even if the
    // row shape changes later.
    const releaseState = await resultRepository.findVisitReleaseStateByVisitTestId(visitTestId);

    // Releasing a result is three writes that describe one clinical event, so they commit or fail
    // together. Two of the three failure modes are silent and permanent:
    //
    //   - ticket marked Completed but released_by never written: the audit trail cannot say who
    //     authorised releasing a medical result, which is the one question it exists to answer.
    //   - both written but the visit never closed: the visit sits in Processing forever, inflating
    //     the front desk queue and the cashier's billing list with work that is actually finished.
    //
    // The transaction also serialises two staff releasing the same result at once — the second
    // waits for the first's row lock rather than interleaving with it.
    await db.withTransaction(async () => {
      await testRepository.updateVisitTestStatus(visitTestId, 'Completed');

      // Persist WHO authorised this. `releasedBy` was already being passed in from the controller
      // and then dropped on the floor, so released_by kept whatever the findings-upload path wrote
      // — i.e. the author, not the authoriser. Whenever those are two different people, which is
      // the entire reason 'Waiting for Release' exists as a separate state, the record named the
      // wrong one.
      await resultRepository.markReleased(visitTestId, releasedBy);

      // Once nothing on the visit is outstanding, the visit itself is done — otherwise it would
      // sit in 'Processing' forever, permanently inflating the front desk's active queue and the
      // cashier's billing list.
      if (releaseState && !(await visitRepository.hasOutstandingTests(releaseState.visit_id))) {
        await visitRepository.updateVisitStatus(releaseState.visit_id, 'Completed');
      }
    });

    // Attempt to send email notification to patient. sendEmail() never throws (it swallows
    // SMTP failures and returns {error}/{skipped} instead, per backend/src/config/email.js) —
    // UI/UX Modernization Phase 11: previously that return value was discarded here, so the
    // controller always reported "patient notified via email" even when nothing was sent.
    const patientInfo = await resultRepository.findPatientEmailByVisitTestId(visitTestId);
    let emailStatus = 'no_email';
    if (patientInfo && patientInfo.email) {
      const emailResult = await sendEmail({
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
      emailStatus = (emailResult?.error || emailResult?.skipped) ? 'failed' : 'sent';
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

    return { ...result, emailStatus };
  }

  // Lets the modality re-open a ticket that is already 'Waiting for Release' and edit the
  // findings it recorded earlier, instead of overwriting them with a blank form.
  async getResultByVisitTestId(visitTestId, requestingUser) {
    await assertStaffOwnsVisitTest(requestingUser, visitTestId);
    return await resultRepository.findResultByVisitTestId(visitTestId);
  }

  /**
   * A patient's full diagnostic history, scoped to what the caller is allowed to see.
   *
   * This method used to take only `patientId` and pass it straight through — the one method in
   * this service with no authorization argument at all. The controller checks Client ownership,
   * but that branch is skipped for every staff role, so a Laboratory Staff token calling
   * GET /api/results/history/1,2,3… received every result for every patient across Xray,
   * Ultrasound and 2D Echo, findings text included. That is exactly the department separation
   * assertStaffAllowedCategory was written to enforce on the other routes; this one was missed.
   *
   * The filter is applied in SQL rather than after the fetch, so rows the caller may not see are
   * never loaded and never cross the wire.
   */
  async getPatientHistory(patientId, requestingUser) {
    return await resultRepository.findResultsByPatientId(
      patientId,
      visibleCategoriesFor(requestingUser)
    );
  }
}

module.exports = new ResultService();
