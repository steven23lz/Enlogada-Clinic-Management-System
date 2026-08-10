const paymentRepository = require('../repositories/paymentRepository');

class PaymentService {
  async getBillingSummary(visitId) {
    const { visitInfo, items } = await paymentRepository.getBillingSummary(visitId);
    if (!visitInfo) {
      const error = new Error('Visit not found');
      error.statusCode = 404;
      throw error;
    }

    const subtotal = items.reduce((sum, item) => sum + parseFloat(item.price_at_time), 0);
    // HMO coverage is earned per test, from an actually-approved hmo_request_tests row (Module
    // 15's data) — not assumed wholesale from the patient's billing category. A patient
    // registered under the "HMO" patient_type with no approved request for a given test pays
    // for that test in full; a patient with only some tests approved gets partial coverage.
    const hmoCoverage = items
      .filter((item) => item.hmo_approval_status === 'Approved')
      .reduce((sum, item) => sum + parseFloat(item.price_at_time), 0);
    const totalAmount = subtotal - hmoCoverage;

    const formattedItems = items.map(item => ({
      id: item.visit_test_id,
      name: item.test_name,
      category: item.category_name,
      price: parseFloat(item.price_at_time).toFixed(2),
      status: item.status,
      hmoApproved: item.hmo_approval_status === 'Approved'
    }));

    return {
      visitId,
      patientName: `${visitInfo.first_name} ${visitInfo.last_name}`,
      patientType: visitInfo.patient_type_name,
      items: formattedItems,
      subtotal: subtotal.toFixed(2),
      hmoCoverage: hmoCoverage.toFixed(2),
      totalAmount: totalAmount.toFixed(2)
    };
  }

  async processPayment({ patientVisitId, processedBy, paymentMethod, referenceNumber, amount }) {
    // Recompute the authoritative bill server-side — also serves as the visit-exists check —
    // rather than trusting the client-submitted amount outright.
    const bill = await this.getBillingSummary(patientVisitId);

    const alreadyPaid = await paymentRepository.hasPaidPayment(patientVisitId);
    if (alreadyPaid) {
      const error = new Error('This visit has already been paid. Refresh the billing queue.');
      error.statusCode = 409;
      throw error;
    }

    const authoritativeTotal = parseFloat(bill.totalAmount);
    const submittedAmount = parseFloat(amount);
    if (isNaN(submittedAmount) || Math.abs(submittedAmount - authoritativeTotal) > 0.01) {
      const error = new Error(`Submitted amount (₱${amount}) does not match the billed total (₱${authoritativeTotal.toFixed(2)}).`);
      error.statusCode = 400;
      throw error;
    }

    const receiptNumber = await paymentRepository.getNextReceiptNumber();

    const payment = await paymentRepository.createPayment({
      patientVisitId,
      processedBy,
      paymentMethod,
      referenceNumber,
      receiptNumber,
      amount: authoritativeTotal
    });

    return payment;
  }

  async getTransactions({ startDate, endDate }) {
    return await paymentRepository.findTransactions({ startDate, endDate });
  }

  async getPaymentsForVisit(visitId) {
    return await paymentRepository.findPaymentsByVisitId(visitId);
  }

  async getPaymentsForClient(userId) {
    return await paymentRepository.findPaymentsByPatientUserId(userId);
  }
}

module.exports = new PaymentService();
