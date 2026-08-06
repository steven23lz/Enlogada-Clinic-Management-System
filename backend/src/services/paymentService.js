const paymentRepository = require('../repositories/paymentRepository');

class PaymentService {
  async getBillingSummary(visitId) {
    const { visitInfo, items } = await paymentRepository.getBillingSummary(visitId);
    const subtotal = items.reduce((sum, item) => sum + parseFloat(item.price_at_time), 0);
    const hmoCoverage = (visitInfo?.patient_type_name === 'HMO') ? subtotal : 0;
    const totalAmount = subtotal - hmoCoverage;

    const formattedItems = items.map(item => ({
      id: item.visit_test_id,
      name: item.test_name,
      category: item.category_name,
      price: parseFloat(item.price_at_time).toFixed(2),
      status: item.status
    }));

    return {
      visitId,
      patientName: visitInfo ? `${visitInfo.first_name} ${visitInfo.last_name}` : 'Unknown Patient',
      patientType: visitInfo?.patient_type_name || 'Self Pay',
      items: formattedItems,
      subtotal: subtotal.toFixed(2),
      hmoCoverage: hmoCoverage.toFixed(2),
      totalAmount: totalAmount.toFixed(2)
    };
  }

  async processPayment({ patientVisitId, processedBy, paymentMethod, referenceNumber, amount }) {
    // Auto-generate receipt number
    const receiptNumber = await paymentRepository.getNextReceiptNumber();

    const payment = await paymentRepository.createPayment({
      patientVisitId,
      processedBy,
      paymentMethod,
      referenceNumber,
      receiptNumber,
      amount
    });

    return payment;
  }

  async getTransactions({ startDate, endDate }) {
    return await paymentRepository.findTransactions({ startDate, endDate });
  }

  async getPaymentsForVisit(visitId) {
    return await paymentRepository.findPaymentsByVisitId(visitId);
  }
}

module.exports = new PaymentService();
