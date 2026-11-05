const db = require('../config/database');

/**
 * All SQL for the clinic's package deals. See migrations.md [1.45.0].
 *
 * A package is a fixed-price bundle that DECOMPOSES into ordinary tests — it is never a `tests`
 * row itself, because a row has one `category_id` and that is what routes work to a department
 * worklist, while every package here spans Laboratory and Ultrasound at once.
 */
class PackageRepository {
  /**
   * Active packages with their components, one row per component.
   *
   * [1.158.0] Only tests still offered. Retiring a test takes it out of its packages
   * (packageService.afterTestChanged); this holds the rule against a row changed any other way. It
   * used to keep retired tests in, for HIV Screening, then switched off for having no price of its own.
   */
  async findActiveWithItems() {
    const queryText = `
      SELECT p.id, p.code, p.name, p.price, p.description,
             t.id           AS test_id,
             t.name         AS test_name,
             t.price        AS test_price,
             t.preparation  AS test_preparation,
             tc.name        AS category_name
        FROM test_packages p
        JOIN test_package_items pi ON pi.package_id = p.id
        JOIN tests t               ON t.id = pi.test_id
        JOIN test_categories tc    ON tc.id = t.category_id
       WHERE p.is_active AND t.is_active
       ORDER BY p.code, tc.name, t.name
    `;
    const result = await db.query(queryText);
    return result.rows;
  }

  /** Every package including retired ones, for the management screen. */
  async findAllWithItems() {
    const queryText = `
      SELECT p.id, p.code, p.name, p.price, p.description, p.is_active,
             t.id           AS test_id,
             t.name         AS test_name,
             t.price        AS test_price,
             t.preparation  AS test_preparation,
             tc.name        AS category_name
        FROM test_packages p
        LEFT JOIN test_package_items pi ON pi.package_id = p.id
        LEFT JOIN tests t               ON t.id = pi.test_id
        LEFT JOIN test_categories tc    ON tc.id = t.category_id
       ORDER BY p.code, tc.name, t.name
    `;
    const result = await db.query(queryText);
    return result.rows;
  }

  async create({ code, name, price, description }) {
    const result = await db.query(
      `INSERT INTO test_packages (code, name, price, description, is_active)
       VALUES ($1, $2, $3, $4, TRUE) RETURNING *`,
      [code, name, price, description || null]
    );
    return result.rows[0];
  }

  /**
   * COALESCE per column, so a caller that sends only a price does not blank the description.
   *
   * This is the `testRepository.updateTest` lesson, applied before it could bite: that one writes
   * every column unconditionally, and the Services Catalogue's status toggle therefore wiped each
   * test's patient preparation on every activate/deactivate. See CLAUDE.md.
   */
  async update(id, { code, name, price, description, isActive }) {
    const result = await db.query(
      `UPDATE test_packages
          SET code        = COALESCE($2, code),
              name        = COALESCE($3, name),
              price       = COALESCE($4, price),
              description = COALESCE($5, description),
              is_active   = COALESCE($6, is_active),
              updated_at  = CURRENT_TIMESTAMP
        WHERE id = $1
      RETURNING *`,
      [id, code ?? null, name ?? null, price ?? null, description ?? null, isActive ?? null]
    );
    return result.rows[0];
  }

  async findById(id) {
    const result = await db.query('SELECT * FROM test_packages WHERE id = $1', [id]);
    return result.rows[0];
  }

  /** Replaces the membership wholesale — the caller states what the package IS, not a delta. */
  async setItems(packageId, testIds) {
    await db.query('DELETE FROM test_package_items WHERE package_id = $1', [packageId]);
    for (const testId of testIds) {
      await db.query(
        'INSERT INTO test_package_items (package_id, test_id) VALUES ($1, $2)',
        [packageId, testId]
      );
    }
  }

  /** Another package on offer under this name, whatever its case or spacing. */
  async findOfferedByName(name, exceptId = null) {
    const { rows } = await db.query(
      `SELECT id, code, name, price, is_active FROM test_packages
        WHERE is_active AND LOWER(BTRIM(name)) = LOWER(BTRIM($1)) AND ($2::int IS NULL OR id <> $2::int)
        LIMIT 1`,
      [name, exceptId]
    );
    return rows[0] || null;
  }

  /** Every package holding this test, with the name of each and what its tests add up to now. */
  async findHolding(testId) {
    const { rows } = await db.query(
      `SELECT p.id, p.code, p.name, p.price, p.is_active,
              COUNT(*) FILTER (WHERE t.is_active AND t.id <> $1)::int AS tests_left,
              COALESCE(SUM(t.price) FILTER (WHERE t.is_active AND t.id <> $1), 0) AS others_total,
              (SELECT price FROM tests WHERE id = $1) AS test_price
         FROM test_packages p
         JOIN test_package_items pi ON pi.package_id = p.id
         JOIN tests t ON t.id = pi.test_id
        WHERE p.id IN (SELECT package_id FROM test_package_items WHERE test_id = $1)
        GROUP BY p.id
        ORDER BY p.code`,
      [testId]
    );
    return rows;
  }

  async removeTestFromPackages(testId) {
    await db.query('DELETE FROM test_package_items WHERE test_id = $1', [testId]);
  }

  /** One package and its components, by id: only tests still offered, as above. */
  async findByIdsWithItems(packageIds) {
    if (!packageIds || packageIds.length === 0) return [];
    const queryText = `
      SELECT p.id, p.code, p.name, p.price, p.is_active,
             t.id    AS test_id,
             t.name  AS test_name,
             t.price AS test_price
        FROM test_packages p
        JOIN test_package_items pi ON pi.package_id = p.id
        JOIN tests t               ON t.id = pi.test_id AND t.is_active
       WHERE p.id = ANY($1)
       ORDER BY p.code, t.name
    `;
    const result = await db.query(queryText, [packageIds]);
    return result.rows;
  }
}

module.exports = new PackageRepository();
