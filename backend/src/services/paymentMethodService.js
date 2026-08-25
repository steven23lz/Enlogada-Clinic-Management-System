const path = require('path');
const fs = require('fs');
const paymentMethodRepository = require('../repositories/paymentMethodRepository');
const auditService = require('./auditService');
const { PAYMENT_UPLOAD_ROOT, discardPaymentFile } = require('../config/upload');
const { COUNTER_METHODS } = require('../constants/paymentMethods');

/**
 * The payment channels the clinic publishes. See migrations.md [1.48.0].
 *
 * ── Why every write here is audited ─────────────────────────────────────────────────────────
 *
 * This is the account number a patient is about to send money to. Changing it silently redirects
 * every subsequent payment, and the clinic would find out when the money did not arrive — by which
 * time the only question that matters is who changed it and when. Role edits are not audited in
 * this app because the matrix is visible to everyone who reads it; an account number is not.
 */
class PaymentMethodService {
  /** What a patient may pay into. */
  async listActive() {
    return await paymentMethodRepository.findActive();
  }

  /** Everything, retired included, for the management screen. */
  async listAll() {
    return await paymentMethodRepository.findAll();
  }

  async create(data, actor) {
    if (!data.kind?.trim() || !data.label?.trim()) {
      const error = new Error('A payment method needs a kind and a label.');
      error.statusCode = 400;
      throw error;
    }
    // Rejected here with a readable message rather than left to chk_payment_methods_kind, which
    // would surface as a raw constraint violation. The three are the cash-up buckets: a verified
    // payment is written with this exact value, and anything else either fails chk_payment_method
    // on `payments` or lands in a bucket the drawer has no tile for.
    if (!COUNTER_METHODS.includes(data.kind.trim())) {
      const error = new Error(
        `Kind must be one of ${COUNTER_METHODS.join(', ')} — it decides which cash-up total this settles into.`
      );
      error.statusCode = 400;
      throw error;
    }
    // An account with no number is not a way to pay; it is a way to lose a patient's money.
    if (!data.accountNumber?.trim()) {
      const error = new Error('An account or mobile number is required — it is what the patient pays into.');
      error.statusCode = 400;
      throw error;
    }

    const method = await paymentMethodRepository.create({
      kind: data.kind.trim(),
      label: data.label.trim(),
      accountName: data.accountName?.trim(),
      accountNumber: data.accountNumber.trim(),
      bankName: data.bankName?.trim(),
      instructions: data.instructions?.trim(),
      sortOrder: data.sortOrder,
    });

    await auditService.log({
      actorId: actor?.userId,
      action: 'payment_method.created',
      entityType: 'payment_method',
      entityId: method.id,
      // The number is recorded so a later change can be compared against what it used to be.
      description: `${method.label} — ${method.account_number}`,
    });
    return method;
  }

  async update(id, data, actor) {
    const before = await paymentMethodRepository.findById(id);
    if (!before) {
      const error = new Error('Payment method not found.');
      error.statusCode = 404;
      throw error;
    }

    const method = await paymentMethodRepository.update(id, data);

    // Says what actually changed rather than "updated". An audit line that does not name the old
    // and new account number answers none of the questions that get asked about this table.
    const changes = [];
    if (data.accountNumber !== undefined && data.accountNumber !== before.account_number) {
      changes.push(`account ${before.account_number} -> ${method.account_number}`);
    }
    if (data.isActive !== undefined && data.isActive !== before.is_active) {
      changes.push(method.is_active ? 'reactivated' : 'deactivated');
    }
    if (data.label !== undefined && data.label !== before.label) {
      changes.push(`label "${before.label}" -> "${method.label}"`);
    }

    await auditService.log({
      actorId: actor?.userId,
      action: 'payment_method.updated',
      entityType: 'payment_method',
      entityId: method.id,
      description: changes.length ? changes.join('; ') : `${method.label} edited`,
    });
    return method;
  }

  /**
   * Replace the published QR image.
   *
   * The previous file is deleted only AFTER the row points at the new one, so a failed write never
   * leaves the method with a path to a file that is gone — the patient would get a broken image on
   * the one screen that is asking them for money.
   */
  async setQr(id, file, actor) {
    if (!file) {
      const error = new Error('No QR image was uploaded.');
      error.statusCode = 400;
      throw error;
    }

    const before = await paymentMethodRepository.findById(id);
    if (!before) {
      discardPaymentFile(file);
      const error = new Error('Payment method not found.');
      error.statusCode = 404;
      throw error;
    }

    const method = await paymentMethodRepository.setQr(id, {
      filePath: path.basename(file.path),
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
    });

    if (before.qr_file_path && before.qr_file_path !== method.qr_file_path) {
      fs.unlink(path.join(PAYMENT_UPLOAD_ROOT, before.qr_file_path), () => {});
    }

    await auditService.log({
      actorId: actor?.userId,
      action: 'payment_method.qr_replaced',
      entityType: 'payment_method',
      entityId: method.id,
      description: `${method.label} QR image replaced`,
    });
    return method;
  }

  /**
   * The stored QR image, for the authenticated read-back route.
   *
   * Returns an absolute path built from `path.basename` of the stored value — the value written is
   * already a bare filename, and re-basenaming it means a row somehow holding a traversal string
   * still cannot escape the upload directory.
   */
  async getQrFile(id) {
    const method = await paymentMethodRepository.findById(id);
    if (!method || !method.qr_file_path) {
      const error = new Error('No QR image for this payment method.');
      error.statusCode = 404;
      throw error;
    }
    const absolute = path.join(PAYMENT_UPLOAD_ROOT, path.basename(method.qr_file_path));
    if (!fs.existsSync(absolute)) {
      const error = new Error('The QR image is missing from storage.');
      error.statusCode = 404;
      throw error;
    }
    return { absolute, mimeType: method.qr_mime_type, label: method.label };
  }
}

module.exports = new PaymentMethodService();
