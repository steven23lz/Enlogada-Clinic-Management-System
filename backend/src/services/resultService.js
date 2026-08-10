const resultRepository = require('../repositories/resultRepository');
const testRepository = require('../repositories/testRepository');
const { sendEmail } = require('../config/email');

class ResultService {
  async getPendingByCategory(categoryName) {
    // '2D Echo' is its own row in test_categories, distinct from 'Ultrasound', but
    // MODULE_SCOPE.md explicitly assigns it to the Ultrasound Staff role ("Ultrasound-category
    // (including 2D Echo)") — so it must be independently queryable here even though no staff
    // role is named after it directly.
    const validCategories = ['Laboratory', 'Xray', 'Ultrasound', '2D Echo'];
    if (!validCategories.includes(categoryName)) {
      const error = new Error(`Invalid category. Must be one of: ${validCategories.join(', ')}`);
      error.statusCode = 400;
      throw error;
    }
    return await resultRepository.findPendingByCategory(categoryName);
  }

  async updateTestStatus(visitTestId, status) {
    return await testRepository.updateVisitTestStatus(visitTestId, status);
  }

  async uploadResult({ visitTestId, fileUrl, findings, remarks, releasedBy }) {
    // Mark the visit_test as Completed
    await testRepository.updateVisitTestStatus(visitTestId, 'Completed');

    // Create the result record
    const result = await resultRepository.createResult({
      visitTestId,
      fileUrl,
      findings,
      remarks,
      releasedBy
    });

    return result;
  }

  async releaseResult({ visitTestId, releasedBy }) {
    // Fetch result to confirm it exists
    const result = await resultRepository.findResultByVisitTestId(visitTestId);
    if (!result) {
      const error = new Error('No result found for this visit test. Please upload findings first.');
      error.statusCode = 400;
      throw error;
    }

    // Attempt to send email notification to patient
    const patientInfo = await resultRepository.findPatientEmailByVisitTestId(visitTestId);
    if (patientInfo && patientInfo.email) {
      await sendEmail({
        to: patientInfo.email,
        subject: `Your ${patientInfo.test_name} Results Are Ready - Enlogada Clinic`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Hello ${patientInfo.first_name} ${patientInfo.last_name},</h2>
            <p>Your <strong>${patientInfo.test_name}</strong> results are now available.</p>
            <p>You can view your results by logging in to your account or by visiting the clinic.</p>
            <br/>
            <p>Thank you,</p>
            <p><strong>Enlogada Ultrasound and Diagnostic Clinic</strong></p>
          </div>
        `
      });
    }

    return result;
  }

  async getPatientHistory(patientId) {
    return await resultRepository.findResultsByPatientId(patientId);
  }
}

module.exports = new ResultService();
