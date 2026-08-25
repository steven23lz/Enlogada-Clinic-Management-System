const paymentMethodService = require('../services/paymentMethodService');

class PaymentMethodController {
  /**
   * How a patient may pay. Public and unauthenticated, like the price list.
   *
   * Somebody deciding whether to book needs to know they can pay by GCash before they commit, and
   * the account details are published by the clinic anyway — they are printed on the counter.
   * Retired methods are excluded: a patient must never be shown an account the clinic has closed.
   */
  async getAll(req, res, next) {
    try {
      const methods = await paymentMethodService.listActive();
      return res.status(200).json({ status: 'success', data: { methods } });
    } catch (err) {
      next(err);
    }
  }

  /** Everything, retired included, for the management screen. */
  async getAllForManagement(req, res, next) {
    try {
      const methods = await paymentMethodService.listAll();
      return res.status(200).json({ status: 'success', data: { methods } });
    } catch (err) {
      next(err);
    }
  }

  async create(req, res, next) {
    try {
      const method = await paymentMethodService.create(req.body, req.user);
      return res.status(201).json({
        status: 'success',
        message: `${method.label} added.`,
        data: { method }
      });
    } catch (err) {
      next(err);
    }
  }

  async update(req, res, next) {
    try {
      const method = await paymentMethodService.update(req.params.id, req.body, req.user);
      return res.status(200).json({
        status: 'success',
        message: `${method.label} updated.`,
        data: { method }
      });
    } catch (err) {
      next(err);
    }
  }

  async uploadQr(req, res, next) {
    try {
      const method = await paymentMethodService.setQr(req.params.id, req.file, req.user);
      return res.status(200).json({
        status: 'success',
        message: `QR image saved for ${method.label}.`,
        data: { method }
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * The QR image itself.
   *
   * Authenticated but not role-gated: any signed-in patient about to pay needs to scan it, and it
   * is a public-facing image by nature. Streamed through here rather than served statically for
   * the reason the whole upload directory is — a static mount turns every stored filename into a
   * guessable URL, and this directory also holds patients' payment screenshots.
   */
  async getQr(req, res, next) {
    try {
      const { absolute, mimeType } = await paymentMethodService.getQrFile(req.params.id);
      res.type(mimeType || 'application/octet-stream');
      return res.sendFile(absolute);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new PaymentMethodController();
