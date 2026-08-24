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
   * `t.is_active` is deliberately NOT filtered. HIV Screening is switched off so it cannot be sold
   * on its own at a price nobody set, but it is a real component of all five packages and has to
   * come back here or the bundle silently loses a test.
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
       WHERE p.is_active
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

  /** One package and its components, by id. Same non-filtering of `t.is_active` as above. */
  async findByIdsWithItems(packageIds) {
    if (!packageIds || packageIds.length === 0) return [];
    const queryText = `
      SELECT p.id, p.code, p.name, p.price, p.is_active,
             t.id    AS test_id,
             t.name  AS test_name,
             t.price AS test_price
        FROM test_packages p
        JOIN test_package_items pi ON pi.package_id = p.id
        JOIN tests t               ON t.id = pi.test_id
       WHERE p.id = ANY($1)
       ORDER BY p.code, t.name
    `;
    const result = await db.query(queryText, [packageIds]);
    return result.rows;
  }
}

module.exports = new PackageRepository();
