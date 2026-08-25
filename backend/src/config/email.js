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

/**
 * Whether outbound mail can actually be sent.
 *
 * BOTH halves are required, and the missing one is named. This used to check the username alone,
 * so a half-configured clinic — address filled in, App Password still blank — passed the guard and
 * then failed inside nodemailer on every single send. That reads as a mail outage rather than as a
 * setting nobody finished, and it fails once per released result rather than once at startup.
 *
 * The value of the password is never logged, only whether it is empty. Same rule the payment
 * gateway's isConfigured() follows, and for the same reason.
 */
const missingMailConfig = () => {
  const missing = [];
  if (!env.SMTP_USER || env.SMTP_USER === 'dummy_user@gmail.com') missing.push('SMTP_USER (or EMAIL_USER)');
  if (!env.SMTP_PASS) missing.push('SMTP_PASS (or EMAIL_APP_PASSWORD)');
  return missing;
};

const sendEmail = async ({ to, subject, html }) => {
  try {
    const missing = missingMailConfig();
    if (missing.length > 0) {
      logger.warn(
        `Email skipped — not configured (${missing.join(', ')}). ` +
        `Would have sent to: ${to}, Subject: ${subject}`
      );
      return { skipped: true, missing };
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

module.exports = { sendEmail, missingMailConfig };
