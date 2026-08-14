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
      LEFT JOIN test_results tr ON tr.visit_test_id = vt.id
      LEFT JOIN users u ON tr.released_by = u.id
      WHERE tc.name = $1
        AND vt.status = 'Completed'
      ORDER BY tr.released_at DESC NULLS LAST, pv.created_at DESC
    `;
    const result = await db.query(queryText, [categoryName]);
    return result.rows;
  }

  async createResult({ visitTestId, fileUrl, filePath, fileOriginalName, fileMimeType, fileSizeBytes, findings, remarks, releasedBy }) {
    // Upsert, not a plain insert: the caller always follows this with a separate release call
    // (see resultService.releaseResult) for the same clinically-significant action. If that
    // second call fails (e.g. a network blip) after this one already succeeded, the only way
    // to recover is to retry the whole sequence from the top — which would otherwise violate
    // visit_test_id's UNIQUE constraint and leave the result permanently stuck un-released.
    //
    // Phase B: file_path/file_original_name/file_mime_type/file_size_bytes back a real uploaded
    // file; file_url remains as a nullable legacy fallback. Re-uploading a corrected file (a new
    // POST for the same visit_test_id) overwrites the previous file's metadata row here, but the
    // old physical file on disk is intentionally left in place rather than deleted — this upsert
    // is the one existing code path that already handles "the caller made a mistake and re-sent
    // the request," and adding disk cleanup to it is a separate, riskier concern than this phase
    // set out to solve.
    const queryText = `
      INSERT INTO test_results (visit_test_id, file_url, file_path, file_original_name, file_mime_type, file_size_bytes, findings, remarks, released_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (visit_test_id) DO UPDATE
      SET file_url = EXCLUDED.file_url,
          file_path = EXCLUDED.file_path,
          file_original_name = EXCLUDED.file_original_name,
          file_mime_type = EXCLUDED.file_mime_type,
          file_size_bytes = EXCLUDED.file_size_bytes,
          findings = EXCLUDED.findings,
          remarks = EXCLUDED.remarks,
          released_by = EXCLUDED.released_by,
          released_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    const result = await db.query(queryText, [
      visitTestId, fileUrl || null, filePath || null, fileOriginalName || null, fileMimeType || null, fileSizeBytes || null, findings, remarks, releasedBy
    ]);
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

  async findResultByVisitTestId(visitTestId) {
    const queryText = `
      SELECT tr.*, u.first_name as released_by_first_name, u.last_name as released_by_last_name
      FROM test_results tr
      LEFT JOIN users u ON tr.released_by = u.id
      WHERE tr.visit_test_id = $1
    `;
    const result = await db.query(queryText, [visitTestId]);
    return result.rows[0];
  }

  async findResultsByPatientId(patientId) {
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
      LEFT JOIN test_results tr ON tr.visit_test_id = vt.id
      LEFT JOIN users u ON tr.released_by = u.id
      WHERE pv.patient_id = $1
      ORDER BY pv.created_at DESC
    `;
    const result = await db.query(queryText, [patientId]);
    return result.rows;
  }

  async findPatientEmailByVisitTestId(visitTestId) {
    const queryText = `
      SELECT u.email, p.first_name, p.last_name, t.name as test_name
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
