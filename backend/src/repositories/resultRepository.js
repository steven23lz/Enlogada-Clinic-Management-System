const db = require('../config/database');

class ResultRepository {
  // The modality worklist gate. This query previously filtered on vt.status alone and never
  // looked at the parent visit at all, so a ticket appeared here the instant a client picked
  // tests during online booking — before the receptionist confirmed anything, before payment,
  // and for cancelled visits too. `pv.status = 'Processing'` is the whole gate: a visit only
  // reaches that state through visitService.releaseVisitIfReady (paid + staff-confirmed).
  //
  // vt.status is correspondingly narrowed to the two states a released ticket can be in.
  // 'Pending'/'Approved' tests are by definition not released and belong to the front desk
  // and cashier only.
  async findPendingByCategory(categoryName) {
    const queryText = `
      SELECT vt.id as visit_test_id, vt.status as test_status, vt.price_at_time, vt.remarks,
             t.name as test_name, tc.name as category_name,
             pv.id as visit_id, pv.queue_number, pv.visit_type,
             -- How long this patient has been in the building. The worklist previously showed no
             -- waiting time at all, so a ticket could sit in a department indefinitely with
             -- nothing on screen saying so; the billing queue had this and the modalities did not.
             pv.created_at as visit_created_at,
             p.id as patient_id, p.first_name, p.last_name, p.birthdate, p.sex,
             (
               SELECT hrt.approval_status
               FROM hmo_request_tests hrt
               WHERE hrt.visit_test_id = vt.id
               ORDER BY hrt.created_at DESC
               LIMIT 1
             ) as hmo_approval_status
      FROM visit_tests vt
      JOIN tests t ON vt.test_id = t.id
      JOIN test_categories tc ON t.category_id = tc.id
      JOIN patient_visits pv ON vt.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      WHERE tc.name = $1
        AND pv.status = 'Processing'
        AND vt.status IN ('Processing', 'Waiting for Release')
      ORDER BY pv.created_at ASC
    `;
    const result = await db.query(queryText, [categoryName]);
    return result.rows;
  }

  // Parent-visit release state for a single visit_test — backs the service-layer guard that
  // stops a modality acting on a ticket that was never released to them, independently of
  // whether the UI ever showed it.
  async findVisitReleaseStateByVisitTestId(visitTestId) {
    const queryText = `
      SELECT pv.id as visit_id, pv.status as visit_status, tc.name as category_name
      FROM visit_tests vt
      JOIN tests t ON vt.test_id = t.id
      JOIN test_categories tc ON t.category_id = tc.id
      JOIN patient_visits pv ON vt.patient_visit_id = pv.id
      WHERE vt.id = $1
    `;
    const result = await db.query(queryText, [visitTestId]);
    return result.rows[0];
  }

  // UI/UX Phase 1: diagnostic staff previously had no way to review results they'd already
  // released from this app at all — the pending-worklist endpoint above only ever returns
  // Pending/Approved/Processing tests. Mirrors findPendingByCategory's shape/filtering exactly,
  // just against 'Completed' status and joined to the actual result content.
  async findReleasedByCategory(categoryName) {
    const queryText = `
      SELECT vt.id as visit_test_id, vt.status as test_status,
             t.name as test_name, tc.name as category_name,
             pv.id as visit_id, pv.queue_number,
             p.id as patient_id, p.first_name, p.last_name,
             tr.findings, tr.remarks as result_remarks, tr.file_url, tr.file_path, tr.released_at,
             u.first_name as released_by_first_name, u.last_name as released_by_last_name
      FROM visit_tests vt
      JOIN tests t ON vt.test_id = t.id
      JOIN test_categories tc ON t.category_id = tc.id
      JOIN patient_visits pv ON vt.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      -- is_current: a test can now carry several versions, and joining them all would repeat
      -- the row once per amendment and show superseded findings alongside the live ones.
      LEFT JOIN test_results tr ON tr.visit_test_id = vt.id AND tr.is_current
      LEFT JOIN users u ON tr.released_by = u.id
      WHERE tc.name = $1
        AND vt.status = 'Completed'
      ORDER BY tr.released_at DESC NULLS LAST, pv.created_at DESC
    `;
    const result = await db.query(queryText, [categoryName]);
    return result.rows;
  }

  async createResult({ visitTestId, fileUrl, filePath, fileOriginalName, fileMimeType, fileSizeBytes, findings, remarks, releasedBy, amendmentReason, isCritical }) {
    // Writes a NEW VERSION rather than overwriting the previous one.
    //
    // This used to be `ON CONFLICT (visit_test_id) DO UPDATE`, which overwrote findings, remarks
    // and file metadata in place. A radiology report already issued to a patient could therefore
    // be silently rewritten, with nothing anywhere recording what it originally said — and the
    // audit entry noted only *that* a correction happened, never what changed. For a diagnostic
    // report that is indefensible: the patient may have acted on the first version, and a
    // referring physician certainly may have.
    //
    // Each save supersedes the current row and inserts the next version, so the chain is walkable
    // in both directions (superseded_by forwards, version backwards). The partial unique index
    // uq_test_results_current_per_test keeps "exactly one current result per test" true, which is
    // the invariant the old UNIQUE was really protecting — so every reader that expects a single
    // row still gets one, as long as it filters on is_current. They all do.
    //
    // Runs inside a transaction because superseding and inserting must not come apart: a failure
    // between them would leave a test with NO current result, which reads as "findings never
    // recorded" and is worse than either version winning.
    //
    // Phase B: file_path/file_original_name/file_mime_type/file_size_bytes back a real uploaded
    // file; file_url remains as a nullable legacy fallback.
    return await db.withTransaction(async () => {
      const previous = (
        await db.query(
          `SELECT id, version FROM test_results
           WHERE visit_test_id = $1 AND is_current
           FOR UPDATE`,
          [visitTestId]
        )
      ).rows[0];

      if (previous) {
        await db.query(
          `UPDATE test_results SET is_current = FALSE WHERE id = $1`,
          [previous.id]
        );
      }

      const inserted = await db.query(
        `INSERT INTO test_results (
           visit_test_id, file_url, file_path, file_original_name, file_mime_type, file_size_bytes,
           findings, remarks, released_by, recorded_by,
           version, is_current, amendment_reason, is_critical
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, TRUE, $11, $12)
         RETURNING *`,
        [
          visitTestId, fileUrl || null, filePath || null, fileOriginalName || null,
          fileMimeType || null, fileSizeBytes || null, findings, remarks, releasedBy,
          previous ? previous.version + 1 : 1,
          // Only meaningful on an amendment; the first version has nothing to explain.
          previous ? (amendmentReason || null) : null,
          Boolean(isCritical),
        ]
      );
      const current = inserted.rows[0];

      // Point the old version at its replacement, so the history reads forwards as well as
      // backwards. Done after the insert because it needs the new row's id.
      if (previous) {
        await db.query(`UPDATE test_results SET superseded_by = $2 WHERE id = $1`, [
          previous.id,
          current.id,
        ]);
      }

      return current;
    });
  }

  /**
   * Every version of a test's result, newest first — the amendment history.
   *
   * Exists so a corrected report can be read alongside what it replaced. Without it the version
   * rows would be written and never surfaced, which is the same as not keeping them.
   */
  async findVersionHistoryByVisitTestId(visitTestId) {
    const queryText = `
      SELECT tr.id, tr.version, tr.is_current, tr.findings, tr.remarks,
             tr.amendment_reason, tr.is_critical,
             tr.released_at, tr.authorised_at, tr.superseded_by,
             rec.first_name AS recorded_by_first_name, rec.last_name AS recorded_by_last_name,
             rel.first_name AS released_by_first_name,  rel.last_name AS released_by_last_name
      FROM test_results tr
      LEFT JOIN users rec ON tr.recorded_by = rec.id
      LEFT JOIN users rel ON tr.released_by = rel.id
      WHERE tr.visit_test_id = $1
      ORDER BY tr.version DESC
    `;
    const result = await db.query(queryText, [visitTestId]);
    return result.rows;
  }

  /**
   * Records that a critical result was actually communicated to someone.
   *
   * The flag is the cheap half. What matters medico-legally is the evidence that a human picked
   * up a phone and told a named person at a recorded time, which is what this stores.
   */
  async acknowledgeCritical(visitTestId, { acknowledgedBy, note }) {
    const queryText = `
      UPDATE test_results
      SET critical_acknowledged_at = CURRENT_TIMESTAMP,
          critical_acknowledged_by = $2,
          critical_acknowledgement_note = $3
      WHERE visit_test_id = $1 AND is_current AND is_critical
      RETURNING *
    `;
    const result = await db.query(queryText, [visitTestId, acknowledgedBy, note || null]);
    return result.rows[0];
  }

  // Phase B: single query backing the download route's ownership check — needs both the
  // patient's user_id (Client-ownership check) and the test's category (staff-department check),
  // matching the two branches assertStaffOwnsVisitTest/getPatientHistory already use elsewhere.
  async findOwnershipInfoByVisitTestId(visitTestId) {
    const queryText = `
      SELECT tc.name as category_name, p.user_id as patient_user_id
      FROM visit_tests vt
      JOIN tests t ON vt.test_id = t.id
      JOIN test_categories tc ON t.category_id = tc.id
      JOIN patient_visits pv ON vt.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      WHERE vt.id = $1
    `;
    const result = await db.query(queryText, [visitTestId]);
    return result.rows[0];
  }

  /**
   * Records WHO authorised the release, at the moment they authorise it.
   *
   * This step existed in the service and the controller — releaseResult() was handed the
   * releasing user's id — but nothing ever persisted it. The ticket flipped to 'Completed' and
   * the actor was dropped, leaving released_by holding whoever had typed the findings.
   */
  async markReleased(visitTestId, releasedBy) {
    const queryText = `
      UPDATE test_results
      SET released_by = $2,
          authorised_at = CURRENT_TIMESTAMP
      -- is_current: without it this would stamp the releasing user onto every superseded
      -- version too, rewriting the attribution of reports that were authorised by someone else
      -- at an earlier time — destroying the very history versioning was added to keep.
      WHERE visit_test_id = $1 AND is_current
      RETURNING *
    `;
    const result = await db.query(queryText, [visitTestId, releasedBy]);
    return result.rows[0];
  }

  async findResultByVisitTestId(visitTestId) {
    const queryText = `
      SELECT tr.*, u.first_name as released_by_first_name, u.last_name as released_by_last_name
      FROM test_results tr
      LEFT JOIN users u ON tr.released_by = u.id
      -- The live version. Callers here mean "the result", not "some past draft of it";
      -- findVersionHistoryByVisitTestId is the way to reach superseded versions.
      WHERE tr.visit_test_id = $1 AND tr.is_current
    `;
    const result = await db.query(queryText, [visitTestId]);
    return result.rows[0];
  }

  /**
   * @param {number|string} patientId
   * @param {string[]|null} allowedCategories - restrict to these test categories; null = all.
   *   Applied in SQL so results the caller may not see are never read, rather than fetched and
   *   filtered afterwards.
   */
  async findResultsByPatientId(patientId, allowedCategories = null) {
    const params = [patientId];
    let categoryFilter = '';
    if (allowedCategories) {
      // An empty array is meaningful: a role mapped to no categories sees nothing, rather than
      // falling through to everything. `= ANY('{}')` is false for every row, which is correct.
      params.push(allowedCategories);
      categoryFilter = `AND tc.name = ANY($${params.length}::text[])`;
    }

    const queryText = `
      SELECT vt.id as visit_test_id, vt.price_at_time, vt.status as test_status,
             t.name as test_name, tc.name as category_name,
             pv.created_at as visit_date, pv.queue_number,
             tr.id as result_id, tr.findings, tr.remarks as result_remarks,
             tr.file_url, tr.file_path, tr.file_original_name, tr.released_at,
             u.first_name as released_by_first_name, u.last_name as released_by_last_name
      FROM visit_tests vt
      JOIN tests t ON vt.test_id = t.id
      JOIN test_categories tc ON t.category_id = tc.id
      JOIN patient_visits pv ON vt.patient_visit_id = pv.id
      -- is_current: a test can now carry several versions, and joining them all would repeat
      -- the row once per amendment and show superseded findings alongside the live ones.
      LEFT JOIN test_results tr ON tr.visit_test_id = vt.id AND tr.is_current
      LEFT JOIN users u ON tr.released_by = u.id
      WHERE pv.patient_id = $1
      ${categoryFilter}
      ORDER BY pv.created_at DESC
    `;
    const result = await db.query(queryText, params);
    return result.rows;
  }

  async findPatientEmailByVisitTestId(visitTestId) {
    const queryText = `
      -- contact_number is here for the critical-result callback: the staff member who has to
      -- telephone the patient should not have to go and look it up while a panic value is
      -- sitting unactioned. Recipients of that notification (Receptionist/Admin/SuperAdmin) are
      -- already entitled to patient contact details.
      SELECT u.email, p.first_name, p.last_name, p.contact_number, t.name as test_name
      FROM visit_tests vt
      JOIN patient_visits pv ON vt.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      LEFT JOIN users u ON p.user_id = u.id
      JOIN tests t ON vt.test_id = t.id
      WHERE vt.id = $1
    `;
    const result = await db.query(queryText, [visitTestId]);
    return result.rows[0];
  }
}

module.exports = new ResultRepository();
