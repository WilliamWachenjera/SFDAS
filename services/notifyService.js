// services/notifyService.js

require('dotenv').config();
const nodemailer = require('nodemailer');
const logger = require('./logger');

// ── Email ─────────────────────────────────────────────
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { rejectUnauthorized: false } // Helps with some server environments
  });
  return transporter;
}

/**
 * Verifies if the SMTP transporter is working
 */
async function verifyConnection() {
  const t = getTransporter();
  if (!t) {
    logger.warn('📧 Email service not configured (missing SMTP_USER or SMTP_PASS)');
    return false;
  }
  try {
    await t.verify();
    logger.info('✅ Email service (SMTP) is ready');
    return true;
  } catch (e) {
    logger.error(`❌ Email service error: ${e.message}`);
    return false;
  }
}

async function sendEmail({ to, subject, text, html }) {
  const t = getTransporter();
  if (!t) { logger.warn('Email not configured — skipping'); return false; }

  const recipients = to || (process.env.ALERT_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
  if (!recipients.length) return false;

  try {
    await t.sendMail({
      from: `SFDAASS <${process.env.SMTP_USER}>`,
      to: Array.isArray(recipients) ? recipients.join(', ') : recipients,
      subject,
      text,
      html: html || text,
    });
    logger.info(`📧 Email sent: ${subject}`);
    return true;
  } catch (e) {
    logger.error(`Email error: ${e.message}`);
    return false;
  }
}

// ── SMS via Twilio ─────────────────────────────────────
async function sendSMS(message) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    logger.warn('Twilio not configured — SMS skipped');
    return false;
  }
  try {
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const numbers = (process.env.ALERT_PHONE_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean);
    await Promise.all(numbers.map(to =>
      twilio.messages.create({ body: message, from: process.env.TWILIO_FROM_NUMBER, to })
    ));
    logger.info(`📱 SMS sent to ${numbers.length} recipient(s)`);
    return true;
  } catch (e) {
    logger.error(`SMS error: ${e.message}`);
    return false;
  }
}

module.exports = { sendEmail, sendSMS, verifyConnection };
