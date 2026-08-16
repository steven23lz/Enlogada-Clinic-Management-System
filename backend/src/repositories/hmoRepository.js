const db = require('../config/database');

class HmoRepository {
  // UI/UX Modernization Phase 12: previously a caller-supplied approvalCode auto-approved the
  // request in this same call (status/approved_date set from the code's mere presence) — the
  // create step is Reception logging what the patient's HMO card/LOA shows, not an actual
  // verification, so a request always starts Pending regardless of whether a code was typed.
  // approval_code is still stored (Admin sees exactly what was submitted when reviewing), it just
  // no longer self-approves. Only hmoRepository.approveRequest (Admin/SuperAdmin-only route, see
  // hmoRoutes.js) can move a request to Approved. That matters more now that Clients can file
  // their own requests from the booking flow: a client states a claim, staff still grant it.
  //
  // The request and its linked tests are written together. Previously the parent row was
  // inserted first and each link appended in a loop from the service, so a failure partway
  // through left an orphaned hmo_requests row carrying a partial test set — visible to Admin on
  // the Service Requests screen as a claim covering fewer tests than the patient actually asked
  // for, which is a billing error rather than a cosmetic one. Same transaction idiom as
  // notificationRepository.createEventForUsers.
  async createRequestWithTests({ hmoProviderId, approvalCode = null, visitTestIds }) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const requestResult = await client.query(
        `INSERT INTO hmo_requests (hmo_provider_id, approval_code, status)
         VALUES ($1, $2, 'Pending')
         RETURNING *`,
        [hmoProviderId, approvalCode]
      );
      const request = requestResult.rows[0];

      const testsResult = await client.query(
        `INSERT INTO hmo_request_tests (hmo_request_id, visit_test_id)
         SELECT $1, unnest($2::int[])
         RETURNING *`,
        [request.id, visitTestIds]
      );

      await client.query('COMMIT');
      return { ...request, tests: testsResult.rows };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Resolves a set of visit_test ids to the user account that owns each one, for the ownership
  // check in hmoService. Returns one row per id that actually exists, so a caller can detect
  // unknown ids by what is missing from the result. patients.user_id is nullable — a walk-in
  // registered at the front desk has no web account — so the comparison is deliberately left to
  // the caller in JS rather than filtered in SQL, where NULL would compare as UNKNOWN and drop
  // the row silently instead of denying it.
  async findOwnershipInfoByVisitTestIds(visitTestIds) {
    const queryText = `
      SELECT vt.id AS visit_test_id,
             pv.id AS visit_id,
             p.user_id AS patient_user_id
      FROM visit_tests vt
      JOIN patient_visits pv ON vt.patient_visit_id = pv.id
      JOIN patients p ON pv.patient_id = p.id
      WHERE vt.id = ANY($1::int[])
    `;
    const result = await db.query(queryText, [visitTestIds]);
    return result.rows;
  }

  async findRequestById(id) {
    const queryText = `
      SELECT hr.*, hp.name as provider_name
      FROM hmo_requests hr
      JOIN hmo_providers hp ON hr.hmo_provider_id = hp.id
      WHERE hr.id = $1
    `;
    const result = await db.query(queryText, [id]);
    return result.rows[0];
  }

  async approveRequest(id, { approvalCode }) {
    const queryText = `
      UPDATE hmo_requests
      SET status = 'Approved', approval_code = $1, approved_date = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;
    const result = await db.query(queryText, [approvalCode, id]);
    return result.rows[0];
  }

  async updateRequestStatus(id, status) {
    const queryText = `
      UPDATE hmo_requests
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;
    const result = await db.query(queryText, [status, id]);
    return result.rows[0];
  }

  async findTestsByRequestId(hmoRequestId) {
    const queryText = `
      SELECT hrt.*, vt.price_at_time, t.name as test_name, tc.name as category_name
      FROM hmo_request_tests hrt
      JOIN visit_tests vt ON hrt.visit_test_id = vt.id
      JOIN tests t ON vt.test_id = t.id
      JOIN test_categories tc ON t.category_id = tc.id
      WHERE hrt.hmo_request_id = $1
      ORDER BY tc.name, t.name
    `;
    const result = await db.query(queryText, [hmoRequestId]);
    return result.rows;
  }

  async updateTestApprovalStatus(hmoRequestTestId, approvalStatus) {
    const queryText = `
      UPDATE hmo_request_tests
      SET approval_status = $1
      WHERE id = $2
      RETURNING *
    `;
    const result = await db.query(queryText, [approvalStatus, hmoRequestTestId]);
    return result.rows[0];
  }

  // No "list requests" capability existed before — approval was only reachable if you already
  // knew a specific request ID, making the approval half of the HMO flow practically
  // undiscoverable through any UI.
  async findAllRequests({ status } = {}) {
    const params = [];
    let whereClause = '';
    if (status) {
      params.push(status);
      whereClause = 'WHERE hr.status = $1';
    }

    const queryText = `
      SELECT hr.*, hp.name as provider_name,
             COUNT(hrt.id) as test_count,
             COUNT(hrt.id) FILTER (WHERE hrt.approval_status = 'Approved') as approved_test_count
      FROM hmo_requests hr
      JOIN hmo_providers hp ON hr.hmo_provider_id = hp.id
      LEFT JOIN hmo_request_tests hrt ON hrt.hmo_request_id = hr.id
      ${whereClause}
      GROUP BY hr.id, hp.name
      ORDER BY hr.request_date DESC
    `;
    const result = await db.query(queryText, params);
    return result.rows;
  }

  async findAllProviders() {
    const queryText = 'SELECT * FROM hmo_providers ORDER BY name';
    const result = await db.query(queryText);
    return result.rows;
  }

  async findProviderById(id) {
    const result = await db.query('SELECT * FROM hmo_providers WHERE id = $1', [id]);
    return result.rows[0];
  }

  async createProvider(name) {
    const result = await db.query(
      'INSERT INTO hmo_providers (name, is_active) VALUES ($1, TRUE) RETURNING *',
      [name]
    );
    return result.rows[0];
  }

  async updateProvider(id, { name, isActive }) {
    const result = await db.query(
      'UPDATE hmo_providers SET name = COALESCE($1, name), is_active = COALESCE($2, is_active) WHERE id = $3 RETURNING *',
      [name ?? null, isActive ?? null, id]
    );
    return result.rows[0];
  }
}

module.exports = new HmoRepository();
