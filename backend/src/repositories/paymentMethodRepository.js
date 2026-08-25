const db = require('../config/database');

/**
 * All SQL for the payment channels the clinic publishes. See migrations.md [1.48.0].
 *
 * These rows are where a patient's money is about to be sent. A wrong account number here routes
 * real payments to a stranger, which is why the write side is SuperAdmin-only and audited.
 */
class PaymentMethodRepository {
  /**
   * What a patient may pay into. Never returns the file path — see `findByIdForFile` for that.
   *
   * `has_qr` rather than the path itself: the image is served through an authorised route by id,
   * and handing the storage key to the browser invites somebody to try reading it directly.
   */
  async findActive() {
    const result = await db.query(`
      SELECT id, kind, label, account_name, account_number, bank_name, instructions, sort_order,
             (qr_file_path IS NOT NULL) AS has_qr
        FROM payment_methods
       WHERE is_active
       ORDER BY sort_order, id
    `);
    return result.rows;
  }

  /** Everything, retired included, for the management screen. */
  async findAll() {
    const result = await db.query(`
      SELECT id, kind, label, account_name, account_number, bank_name, instructions, sort_order,
             is_active, created_at, updated_at,
             (qr_file_path IS NOT NULL) AS has_qr
        FROM payment_methods
       ORDER BY sort_order, id
    `);
    return result.rows;
  }

  async findById(id) {
    const result = await db.query('SELECT * FROM payment_methods WHERE id = $1', [id]);
    return result.rows[0];
  }

  async create({ kind, label, accountName, accountNumber, bankName, instructions, sortOrder }) {
    const result = await db.query(
      `INSERT INTO payment_methods
         (kind, label, account_name, account_number, bank_name, instructions, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 0), TRUE)
       RETURNING *`,
      [kind, label, accountName || null, accountNumber || null, bankName || null,
        instructions || null, sortOrder]
    );
    return result.rows[0];
  }

  /**
   * COALESCE per column, so a caller that sends only `isActive` does not blank the account number.
   *
   * The `testRepository.updateTest` lesson: that one writes every column unconditionally, and the
   * Services Catalogue's status toggle therefore wiped each test's patient preparation. On this
   * table the equivalent slip would erase the account number a patient is about to pay into.
   */
  async update(id, { kind, label, accountName, accountNumber, bankName, instructions, sortOrder, isActive }) {
    const result = await db.query(
      `UPDATE payment_methods
          SET kind           = COALESCE($2, kind),
              label          = COALESCE($3, label),
              account_name   = COALESCE($4, account_name),
              account_number = COALESCE($5, account_number),
              bank_name      = COALESCE($6, bank_name),
              instructions   = COALESCE($7, instructions),
              sort_order     = COALESCE($8, sort_order),
              is_active      = COALESCE($9, is_active),
              updated_at     = CURRENT_TIMESTAMP
        WHERE id = $1
      RETURNING *`,
      [id, kind ?? null, label ?? null, accountName ?? null, accountNumber ?? null,
        bankName ?? null, instructions ?? null, sortOrder ?? null, isActive ?? null]
    );
    return result.rows[0];
  }

  /** Attaches a freshly uploaded QR, returning the path it replaced so the caller can delete it. */
  async setQr(id, { filePath, originalName, mimeType, sizeBytes }) {
    const result = await db.query(
      `UPDATE payment_methods
          SET qr_file_path = $2, qr_original_name = $3, qr_mime_type = $4, qr_size_bytes = $5,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      RETURNING *`,
      [id, filePath, originalName, mimeType, sizeBytes]
    );
    return result.rows[0];
  }
}

module.exports = new PaymentMethodRepository();
