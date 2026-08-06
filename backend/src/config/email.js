const nodemailer = require('nodemailer');
const env = require('./environment');
const logger = require('./logger');

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: false, // TLS
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS
  }
});

const sendEmail = async ({ to, subject, html }) => {
  try {
    if (!env.SMTP_USER || env.SMTP_USER === 'dummy_user@gmail.com') {
      logger.warn(`Email sending skipped (SMTP not configured). Would have sent to: ${to}, Subject: ${subject}`);
      return { skipped: true };
    }

    const info = await transporter.sendMail({
      from: env.SMTP_FROM,
      to,
      subject,
      html
    });

    logger.info(`Email sent to ${to}: ${info.messageId}`);
    return info;
  } catch (err) {
    logger.error('Email sending failed:', err);
    // Don't throw — email failure should not break the main workflow
    return { error: err.message };
  }
};

module.exports = { sendEmail };
