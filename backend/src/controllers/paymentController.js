const paymentService = require('../services/paymentService');

class PaymentController {
  async getBill(req, res, next) {
    try {
      const { visitId } = req.params;
      const bill = await paymentService.getBillingSummary(visitId);
      return res.status(200).json({
        status: 'success',
        data: { bill }
      });
    } catch (err) {
      next(err);
    }
  }

  async processPayment(req, res, next) {
    try {
      const { patientVisitId, paymentMethod, referenceNumber, amount } = req.body;
      const processedBy = req.user.userId;

      if (!patientVisitId || !paymentMethod || amount === undefined) {
        return res.status(400).json({
          status: 'error',
          message: 'Patient visit ID, payment method, and amount are required.'
        });
      }

      const payment = await paymentService.processPayment({
        patientVisitId,
        processedBy,
        paymentMethod,
        referenceNumber,
        amount
      });

      return res.status(201).json({
        status: 'success',
        message: `Payment processed. Receipt: ${payment.receipt_number}`,
        data: { payment }
      });
    } catch (err) {
      next(err);
    }
  }

  async updateStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { status, reason } = req.body;

      if (!status) {
        return res.status(400).json({
          status: 'error',
          message: 'A target status is required.'
        });
      }

      const payment = await paymentService.updatePaymentStatus(id, { status, reason }, req.user);
      return res.status(200).json({
        status: 'success',
        message: `Payment marked ${status}.`,
        data: { payment }
      });
    } catch (err) {
      next(err);
    }
  }

  async getTransactions(req, res, next) {
    try {
      const { startDate, endDate } = req.query;
      const transactions = await paymentService.getTransactions({ startDate, endDate });
      return res.status(200).json({
        status: 'success',
        data: { transactions }
      });
    } catch (err) {
      next(err);
    }
  }

  async getVisitPayments(req, res, next) {
    try {
      const { visitId } = req.params;
      const payments = await paymentService.getPaymentsForVisit(visitId);
      return res.status(200).json({
        status: 'success',
        data: { payments }
      });
    } catch (err) {
      next(err);
    }
  }

  async getMyPayments(req, res, next) {
    try {
      const userId = req.user.userId;
      const payments = await paymentService.getPaymentsForClient(userId);
      return res.status(200).json({
        status: 'success',
        data: { payments }
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new PaymentController();
