// services/notifyService.js

require('dotenv').config();
const nodemailer = require('nodemailer');
const logger = require('./logger');

// ── Email ─────────────────────────────────────────────
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  const port = parseInt(process.env.SMTP_PORT) || 587;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,      // true only for SSL port 465; port 587 uses STARTTLS
    requireTLS: port !== 465,  // FIX: force STARTTLS upgrade on port 587; without this
                               // nodemailer may fall back to plaintext and Gmail rejects it
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { rejectUnauthorized: false },
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
async function sendSMS(message, toPhone = null) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    logger.warn('Twilio not configured — SMS skipped');
    return false;
  }
  try {
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    let numbers = [];
    if (toPhone) {
      numbers = [toPhone];
    } else {
      numbers = (process.env.ALERT_PHONE_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean);
    }
    
    if (!numbers.length) return false;

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

async function sendAlert(incident) {
  const isCritical = incident.severity === 'critical';
  const alertSubject = `[SFDAASS] ${isCritical ? '🚨 CRITICAL' : '⚠️ WARNING'}: Fire Incident ${incident.incident_code}`;
  const alertText = `
ALERT: SFDAASS Fire Detection System
-----------------------------------
Incident: ${incident.incident_code}
Severity: ${incident.severity.toUpperCase()}
Location: ${incident.location_label || 'Unknown'}
Sensors: Smoke:${incident.smoke_ppm}ppm, Temp:${incident.temperature_c}°C
Flame Detected: ${incident.flame_detected ? 'YES' : 'NO'}

Status: ${incident.status.toUpperCase()}
Time: ${new Date(incident.detected_at || Date.now()).toLocaleString()}

Please check the dashboard immediately.
  `.trim();

  // Send Email
  await sendEmail({
    subject: alertSubject,
    text: alertText,
    html: `
      <div style="background-color:#060a0f; color:#e8f4fd; font-family:sans-serif; padding:40px; border-radius:12px; max-width:600px; margin:0 auto; border: 1px solid ${isCritical ? '#ff4e1a' : '#ffaa00'};">
        <h2 style="color:${isCritical ? '#ff4e1a' : '#ffaa00'}; margin-top:0;">${isCritical ? '🚨 CRITICAL FIRE ALERT' : '⚠️ FIRE WARNING'}</h2>
        <p>A new incident has been detected by the system.</p>
        <div style="background-color:#0c1520; padding:20px; border-radius:8px; border:1px solid #1a3045;">
          <p><strong>Incident:</strong> ${incident.incident_code}</p>
          <p><strong>Location:</strong> ${incident.location_label || 'Unknown'}</p>
          <p><strong>Severity:</strong> <span style="color:${isCritical ? '#ff4e1a' : '#ffaa00'}; font-weight:bold;">${incident.severity.toUpperCase()}</span></p>
          <p><strong>Smoke:</strong> ${incident.smoke_ppm} ppm</p>
          <p><strong>Temperature:</strong> ${incident.temperature_c} °C</p>
          <p><strong>Flame Sensor:</strong> ${incident.flame_detected ? '<span style="color:#ff4e1a">DETECTED</span>' : 'Clear'}</p>
        </div>
        <p style="margin-top:20px; font-size:14px; color:#7a9ab8;">This is an automated alert from your SFDAASS monitoring system.</p>
      </div>
    `
  });

  // Send SMS (only for critical)
  if (isCritical) {
    await sendSMS(`[SFDAASS] CRITICAL FIRE at ${incident.location_label || 'Unknown'}. Smoke: ${incident.smoke_ppm}ppm, Temp: ${incident.temperature_c}C. Check Dashboard NOW.`);
  }
}

module.exports = { sendEmail, sendSMS, verifyConnection, sendAlert };
