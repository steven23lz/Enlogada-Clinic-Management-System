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
  DIAGNOSTIC_CATEGORIES,
  MODALITY_SETTABLE_TEST_STATUSES,
  departmentsForUser,
  userCoversCategory
} = require('../constants/modality');

// resultController's routes authorize "is this caller some kind of diagnostic staff," not
// "does this visit_test's category match their department" — confirmed live that a Laboratory
// Staff account could call e.g. POST /results/:visitTestId/release on an Xray test with no
// pushback (escalated from Module 9, see TRACEABILITY.md). This closes that gap the same way
// Client ownership is enforced elsewhere in the app: a private guard inside the service layer,
// not just client-side UI routing. SuperAdmin/Admin bypass, matching the RBAC convention used
// everywhere else (they oversee all departments).
// [1.20.0] Reads the caller's *departments* rather than deriving them from role names here.
//
// Same answer for everyone who has not been given an exception — departmentsForUser starts from
// exactly this role mapping. The difference is that a SuperAdmin can now add a modality to one
// account (cover the X-Ray room for a week) without inventing a second role, and this guard
// honours it instead of contradicting it.
function assertStaffAllowedCategory(requestingUser, categoryName) {
  const departments = requestingUser.departments ?? departmentsForUser(requestingUser);
  if (userCoversCategory(departments, categoryName)) return;

  const error = new Error('You are not authorized to act on this test category.');
  error.statusCode = 403;
  throw error;
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
  if (roles.includes('Client')) return null;
  // departmentsForUser already returns null for SuperAdmin/Admin, and otherwise the union of the
  // account's role-implied and directly-granted modalities.
  return requestingUser?.departments ?? departmentsForUser(requestingUser);
}

// Category ownership is only half the question. The other half — added with the ticket-release
// gating work — is whether this ticket was ever released to the modalities at all. Filtering
// findPendingByCategory on the parent visit hides un-released tickets from the worklist UI, but
// hiding is not enforcing: a visit_test id is a small integer, and any diagnostic staff token
// could previously act on one that the receptionist/cashier had not yet handed over. Both
// checks run for every state-changing modality operation.
/**
 * May this member of staff LOOK at this visit_test? Department scope only. [1.26.0]
 *
 * Split out from assertStaffOwnsVisitTest, which additionally requires the visit to be
 * 'Processing'. That release-state condition is right for a write — a technician must not record
 * findings on a ticket the cashier has not released — and wrong for a read, because a visit turns
 * 'Completed' the moment its last result goes out. Both reads were using the write guard, so the
 * technician who produced a report could no longer open it or its version history the instant the
 * visit finished: exactly when somebody rings up to query the result.
 */
async function assertStaffMayReadVisitTest(requestingUser, visitTestId) {
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
}

/** May they WRITE to it? Department scope, plus the ticket-release gate. */
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

  // 'Completed' is allowed as well as 'Processing'. A visit completes when its last result is
  // released, and refusing writes from that moment made amending a released result impossible —
  // which is the one thing result versioning [1.15.0] exists for, since a correction is nearly
  // always discovered after the report has gone out. The alternative was somebody editing the
  // database by hand, which keeps no history at all.
  if (row.visit_status !== 'Processing' && row.visit_status !== 'Completed') {
    const error = new Error(
      'This ticket has not been released to your department yet. It is still with the front desk or cashier.'
    );
    error.statusCode = 403;
    throw error;
  }
}

class ResultService {
  async getPendingByCategory(categoryName, requestingUser) {
    // The list is DIAGNOSTIC_CATEGORIES in constants/modality.js rather than a literal here, so
    // adding or retiring a department changes one file. It used to carry '2D Echo' as a fourth
    // entry — its own test_categories row that MODULE_SCOPE.md assigned to the Ultrasound role —
    // until [1.50.0] removed that category entirely.
    if (!DIAGNOSTIC_CATEGORIES.includes(categoryName)) {
      const error = new Error(`Invalid category. Must be one of: ${DIAGNOSTIC_CATEGORIES.join(', ')}`);
      error.statusCode = 400;
      throw error;
    }
    assertStaffAllowedCategory(requestingUser, categoryName);
    return await resultRepository.findPendingByCategory(categoryName);
  }

  /**
   * @param {{days?: string|number, limit?: string|number, offset?: string|number}} options
   *   Query-string values, so everything is parsed and clamped here rather than trusted.
   */
  async getReleasedByCategory(categoryName, requestingUser, options = {}) {
    if (!DIAGNOSTIC_CATEGORIES.includes(categoryName)) {
      const error = new Error(`Invalid category. Must be one of: ${DIAGNOSTIC_CATEGORIES.join(', ')}`);
      error.statusCode = 400;
      throw error;
    }
    assertStaffAllowedCategory(requestingUser, categoryName);

    // Clamped, not merely defaulted: `limit` reaches this straight from the query string, and the
    // rows it controls carry full clinical narrative in unbounded TEXT columns. An unclamped
    // limit would let any authenticated staff member pull the department's entire result history
    // in one request — the exact unbounded response this window exists to prevent.
    const days = Math.min(Math.max(parseInt(options.days, 10) || 90, 0), 3650);
    const limit = Math.min(Math.max(parseInt(options.limit, 10) || 200, 1), 500);
    const offset = Math.max(parseInt(options.offset, 10) || 0, 0);

    return await resultRepository.findReleasedByCategory(categoryName, { days, limit, offset });
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

  async uploadResult(
    { visitTestId, file, findings, remarks, releasedBy, amendmentReason, isCritical },
    requestingUser
  ) {
    await assertStaffOwnsVisitTest(requestingUser, visitTestId);

    // Fetched once, up front: doubles as (a) the file-preservation source when no new file is
    // attached, and (b) the correction signal below — a result already existing before this call
    // means this is an edit, not a first-time release.
    const existing = await resultRepository.findResultByVisitTestId(visitTestId);
    const isCorrection = !!existing;

    // A reason is required once the report has actually gone out — and only then. [1.26.0]
    //
    // The distinction is 'Completed' vs 'Waiting for Release'. Before release the findings have
    // been seen by nobody outside the department, so re-saving is drafting: demanding a
    // justification for fixing your own typo is friction that buys nothing, and the reason box
    // fills up with "typo" until it means nothing. After release a clinician may have acted on
    // the old version, so "why did this change?" is the question the amendment history exists to
    // answer — and it was optional, with the audit entry reduced to writing "no reason given"
    // against a corrected medical report.
    const releaseState = await resultRepository.findVisitReleaseStateByVisitTestId(visitTestId);
    const releasedAlready = isCorrection && releaseState?.test_status === 'Completed';

    if (releasedAlready && String(amendmentReason || '').trim().length < 4) {
      const error = new Error(
        'This result has already been released to the patient. Say why it is being amended — ' +
          'the reason is kept with both versions, so anyone who acted on the earlier report can see what changed.'
      );
      error.statusCode = 400;
      throw error;
    }

    let filePath = null, fileOriginalName = null, fileMimeType = null, fileSizeBytes = null;

    if (file) {
      filePath = path.relative(UPLOAD_ROOT, file.path);
      fileOriginalName = file.originalname;
      fileMimeType = file.mimetype;
      fileSizeBytes = file.size;
    } else if (existing) {
      // Phase C: this call now also handles correcting an already-released result (editing
      // findings/remarks without re-attaching a file) — without this, re-submitting would
      // silently wipe a previously uploaded file's metadata, since createResult's upsert
      // otherwise overwrites every column unconditionally.
      filePath = existing.file_path;
      fileOriginalName = existing.file_original_name;
      fileMimeType = existing.file_mime_type;
      fileSizeBytes = existing.file_size_bytes;
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

      // Amending a released result has to reopen the visit, or the amendment goes nowhere. [1.26.0]
      //
      // The visit closes when its last result is released. Amending afterwards puts the ticket
      // back to 'Waiting for Release', but the modality worklist filters on
      // `pv.status = 'Processing'` and the Released tab filters on `vt.status = 'Completed'` — so
      // the amended ticket showed on neither. The technician saved the correction, saw it accepted,
      // and it then existed only in the version history: never re-released, so the patient and the
      // referring doctor kept the wrong report. Reopening puts it back where somebody will see it,
      // and releaseResult closes the visit again once it goes out.
      if (releasedAlready) {
        await visitRepository.updateVisitStatus(releaseState.visit_id, 'Processing');
      }

      const created = await resultRepository.createResult({
        visitTestId,
        filePath,
        fileOriginalName,
        fileMimeType,
        fileSizeBytes,
        findings,
        remarks,
        releasedBy,
        amendmentReason,
        isCritical
      });

      // Phase D: only a correction is audit-worthy here — the first-time release of every result
      // would make the log mostly noise from routine work, not the "something changed after the
      // fact" signal an audit trail is for.
      //
      // Inside the transaction on purpose: an audit entry describing a correction that was then
      // rolled back is worse than no entry, because the log is the artifact whose whole value is
      // being trustworthy.
      if (isCorrection) {
        // Names the versions involved and the stated reason. The old entry said only "Corrected
        // findings for visit test #N" — true, and useless: it could not tell you what changed,
        // and the previous text no longer existed anywhere to compare against. Now the superseded
        // version is still on the table, so the log points at both ends of the change.
        await auditService.log({
          actorId: requestingUser?.userId,
          action: 'result.amended',
          entityType: 'test_result',
          entityId: created.id,
          description:
            `Amended visit test #${visitTestId}: version ${existing.version} superseded by ` +
            `version ${created.version}` +
            (amendmentReason ? ` — ${amendmentReason}` : ' — no reason given')
        });
      }

      // A critical result is an event in its own right, whoever recorded it. Logged here rather
      // than only on release so the flag is traceable even if the ticket is never authorised.
      if (isCritical) {
        await auditService.log({
          actorId: requestingUser?.userId,
          action: 'result.flagged_critical',
          entityType: 'test_result',
          entityId: created.id,
          description: `Flagged CRITICAL findings for visit test #${visitTestId} (version ${created.version})`
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
      mimeType: result.file_mime_type || 'application/octet-stream',
      // Returned so the controller can audit the access against the patient rather than only
      // against the visit_test row.
      patientId: ownership.patient_id
    };
  }

  /**
   * Send the patient their report, and WRITE DOWN that it went. [1.59.0]
   *
   * One builder, called by release and by a manual re-send, because two copies of this would
   * drift — and the copy that drifts is the one nobody is looking at, which here means a
   * critical value going out under the cheerful wording while the release path uses the careful
   * one.
   *
   * Recording happens only on success. `emailed_at IS NULL` has to keep meaning "this report has
   * never reached the patient", with no second reading — a failed attempt that stamped the column
   * would turn the one honest signal in the feature into a lie.
   *
   * `sendEmail` never throws: it swallows SMTP failures and returns {error}/{skipped}, so the
   * return value is the only way to know. Discarding it is how this used to report "patient
   * notified" over an unconfigured mail server.
   */
  async deliverResultEmail({ patientInfo, isCritical, isAmendment, visitTestId }) {
    if (!patientInfo || !patientInfo.email) return 'no_email';

    // A panic value must not go out with the same cheerful "your results are ready" wording as a
    // normal CBC. The clinic still telephones — that is what the acknowledgement records — but
    // the email must not read as routine in the meantime, and it must not put a clinical value in
    // front of a patient with no clinician attached to it.
    const subject = isCritical
      ? `IMPORTANT: Please contact Enlogada Clinic about your ${patientInfo.test_name} result`
      : isAmendment
        ? `Updated ${patientInfo.test_name} result - Enlogada Clinic`
        : `Your ${patientInfo.test_name} Results Are Ready - Enlogada Clinic`;

    const body = isCritical
      ? `<p>Your <strong>${patientInfo.test_name}</strong> result requires prompt discussion with a clinician.</p>
         <p><strong>Please contact the clinic as soon as you can</strong>, or proceed to the nearest
            emergency department if you feel unwell. A member of our staff will also be trying to
            reach you by phone.</p>`
      : isAmendment
        ? `<p>Your <strong>${patientInfo.test_name}</strong> report has been <strong>updated</strong>, and the
              revised version replaces the one issued earlier.</p>
           <p>Please use the updated report, and discard or disregard any earlier copy.</p>`
        : `<p>Your <strong>${patientInfo.test_name}</strong> results are now available.</p>
           <p>You can view your results by logging in to your account or by visiting the clinic.</p>`;

    const emailResult = await sendEmail({
      to: patientInfo.email,
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Hello ${patientInfo.first_name} ${patientInfo.last_name},</h2>
          ${body}
          <br/>
          <p>Thank you,</p>
          <p><strong>Enlogada Ultrasound and Diagnostic Clinic</strong></p>
        </div>
      `,
    });

    if (emailResult?.error || emailResult?.skipped) return 'failed';

    await resultRepository.recordEmailDelivery(visitTestId, patientInfo.email);
    return 'sent';
  }

  /**
   * Send a released report to the patient AGAIN, on request. [1.59.0]
   *
   * The gap this closes: release was the only path that emailed, it fired once, and it could not
   * be repeated. A patient who says "I never received it", an address corrected after the fact,
   * an SMTP outage during a release — in every case the only remedy available to a technician was
   * to re-release a result that was already out, which writes a new authorisation record for a
   * clinical event that did not happen again.
   *
   * Refuses on anything not yet released. A report that has not been authorised must not be
   * emailable by another door — that would make `results:release` bypassable by whoever can send
   * an email, and the whole point of 'Waiting for Release' is that authorisation is a separate,
   * deliberate act.
   */
  async emailResult({ visitTestId }, requestingUser) {
    await assertStaffOwnsVisitTest(requestingUser, visitTestId);

    const result = await resultRepository.findResultByVisitTestId(visitTestId);
    if (!result) {
      const error = new Error('There is no report for this test yet, so there is nothing to send.');
      error.statusCode = 404;
      throw error;
    }
    if (!result.released_at || !result.authorised_at) {
      const error = new Error(
        'This report has not been released yet. Release it from the worklist — that notifies the patient as part of the same step.'
      );
      error.statusCode = 409;
      throw error;
    }

    const patientInfo = await resultRepository.findPatientEmailByVisitTestId(visitTestId);
    if (!patientInfo || !patientInfo.email) {
      // A walk-in registered at the counter often has no account and therefore no address. Naming
      // the remedy matters: whoever is holding the phone can fix this in a minute from Patient
      // Records, and "no email on file" alone does not tell them that.
      const error = new Error(
        'This patient has no email address on file. Add one to their record first, then send it again.'
      );
      error.statusCode = 409;
      throw error;
    }

    const emailStatus = await this.deliverResultEmail({
      patientInfo,
      isCritical: Boolean(result.is_critical),
      isAmendment: (result.version || 1) > 1,
      visitTestId,
    });

    if (emailStatus !== 'sent') {
      const error = new Error(
        'The email could not be sent. The clinic mail account may be unreachable — telephone the patient if this one is urgent.'
      );
      error.statusCode = 502;
      throw error;
    }

    // Audited, unlike the automatic send at release: this one is a person deciding to put a
    // medical report in front of a patient a second time, and "who sent this, and when" is the
    // question asked afterwards.
    await auditService.log({
      actorId: requestingUser?.userId,
      action: 'result.emailed',
      entityType: 'test_results',
      entityId: result.id,
      description: `${patientInfo.test_name} for ${patientInfo.first_name} ${patientInfo.last_name} re-sent to ${patientInfo.email}`,
    });

    const fresh = await resultRepository.findResultByVisitTestId(visitTestId);
    return { emailedTo: patientInfo.email, emailedAt: fresh?.emailed_at, emailCount: fresh?.email_count };
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

    // A critical result must not leave the building looking like a routine one. `result` was read
    // before the release, so this is the version being authorised.
    const isCritical = Boolean(result.is_critical);
    const isAmendment = (result.version || 1) > 1;

    const emailStatus = await this.deliverResultEmail({
      patientInfo, isCritical, isAmendment, visitTestId,
    });

    // Module 18 (Notification): Admin/SuperAdmin oversight of diagnostic throughput, matching
    // the existing Reports/oversight theme — not the releasing staff member themselves, who is
    // the actor here, not a recipient.
    // Receptionist is included alongside the Admin/SuperAdmin oversight audience: the front
    // desk owns the queue board, and a ticket finishing at a modality is exactly the kind of
    // modality-side change that has to reflect back to reception.
    if (patientInfo) {
      const patientName = `${patientInfo.first_name} ${patientInfo.last_name}`;

      if (isCritical) {
        // The escalation. An email to the patient is not a callback, and a critical value that
        // nobody is told about is the most dangerous state this system can produce. This puts it
        // in front of the front desk and administrators as an urgent item so somebody picks up a
        // phone — and acknowledgeCritical below records that they did.
        await notificationService.notifyRoles(['Receptionist', 'Admin', 'SuperAdmin'], {
          title: 'CRITICAL RESULT — patient callback required',
          message: `${patientInfo.test_name} for ${patientName}${
            patientInfo.contact_number ? ` — ${patientInfo.contact_number}` : ''
          }`,
          type: 'critical'
        });
      } else {
        await notificationService.notifyRoles(['Receptionist', 'Admin', 'SuperAdmin'], {
          title: isAmendment ? 'Result Amended and Re-released' : 'Result Released',
          message: `${patientInfo.test_name} for ${patientName}`,
          type: isAmendment ? 'info' : 'success'
        });
      }
    }

    return { ...result, emailStatus, isCritical, isAmendment };
  }

  // Lets the modality re-open a ticket that is already 'Waiting for Release' and edit the
  // findings it recorded earlier, instead of overwriting them with a blank form.
  async getResultByVisitTestId(visitTestId, requestingUser) {
    await assertStaffMayReadVisitTest(requestingUser, visitTestId);
    return await resultRepository.findResultByVisitTestId(visitTestId);
  }

  /**
   * The amendment history for a test — every version, newest first.
   *
   * Keeping superseded versions is only half the fix; they have to be readable, or the table is
   * just accumulating rows nobody can see. Ownership is checked the same way as every other
   * result read, since a superseded version is every bit as much PHI as the current one.
   */
  async getVersionHistory(visitTestId, requestingUser) {
    await assertStaffMayReadVisitTest(requestingUser, visitTestId);
    return await resultRepository.findVersionHistoryByVisitTestId(visitTestId);
  }

  /**
   * Every released critical result still waiting for its callback. [1.26.0]
   *
   * Deliberately not department-scoped, unlike the worklists. A panic value is a clinical
   * emergency belonging to whoever can act on it, not to the room that produced it — scoping this
   * would mean a Laboratory potassium of 7.4 is invisible to the receptionist standing next to
   * the telephone. `results:acknowledge_critical` is what gates the route, and every staff role
   * that could make the call already holds it.
   */
  async getOutstandingCriticals() {
    return await resultRepository.findOutstandingCriticals();
  }

  /**
   * Records that a critical result was actually communicated to the patient or their physician.
   *
   * Deliberately open to the front desk as well as the department: reception is usually who makes
   * the call, and a callback that cannot be recorded by the person who made it does not get
   * recorded at all. The note is where "spoke to Dr Reyes at 14:20" goes — that sentence is the
   * part with medico-legal weight, not the flag.
   */
  async acknowledgeCritical(visitTestId, { note }, requestingUser) {
    const result = await resultRepository.findResultByVisitTestId(visitTestId);
    if (!result) {
      const error = new Error('No result found for this visit test.');
      error.statusCode = 404;
      throw error;
    }
    if (!result.is_critical) {
      const error = new Error('This result is not flagged as critical, so there is nothing to acknowledge.');
      error.statusCode = 400;
      throw error;
    }
    if (result.critical_acknowledged_at) {
      const error = new Error('This critical result has already been acknowledged.');
      error.statusCode = 409;
      throw error;
    }

    const acknowledged = await resultRepository.acknowledgeCritical(visitTestId, {
      acknowledgedBy: requestingUser?.userId,
      note,
    });

    await auditService.log({
      actorId: requestingUser?.userId,
      action: 'result.critical_acknowledged',
      entityType: 'test_result',
      entityId: acknowledged.id,
      description:
        `Acknowledged critical result for visit test #${visitTestId}` +
        (note ? ` — ${note}` : ' — no note recorded'),
    });

    return acknowledged;
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
