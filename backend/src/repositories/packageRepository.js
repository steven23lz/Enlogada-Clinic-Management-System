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
