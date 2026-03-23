/**
 * Notification Service
 * Handles email (nodemailer) and SMS (Twilio/stub) alert dispatch
 */

const nodemailer = require('nodemailer');
const logger = require('./logger');
const { query } = require('../database/db');

// ── Email transport ──────────────────────────────────────────────
const getTransport = () => {
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  // Development: log-only stub
  return {
    sendMail: async (opts) => {
      logger.info(`📧 [STUB EMAIL] To: ${opts.to} | Subject: ${opts.subject}`);
      return { messageId: 'stub-' + Date.now() };
    }
  };
};

// ── SMS stub (replace body with Twilio SDK when creds available) ─
const sendSMS = async (to, body) => {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    try {
      const twilio = require('twilio');
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const msg = await client.messages.create({
        body,
        from: process.env.TWILIO_PHONE_NUMBER,
        to,
      });
      logger.info(`📲 SMS sent to ${to}: ${msg.sid}`);
      return { success: true, sid: msg.sid };
    } catch (err) {
      logger.error(`SMS failed to ${to}: ${err.message}`);
      return { success: false, error: err.message };
    }
  } else {
    logger.info(`📲 [STUB SMS] To: ${to} | ${body.substring(0, 80)}`);
    return { success: true, sid: 'stub-' + Date.now() };
  }
};

// ── Log notification to DB ───────────────────────────────────────
const logNotification = async (incidentId, channel, recipient, subject, message, status, errorMsg = null) => {
  try {
    await query(
      `INSERT INTO alert_notifications
         (incident_id, channel, recipient, subject, message, status, sent_at, error_msg)
       VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $6='sent' THEN NOW() ELSE NULL END, $7)`,
      [incidentId, channel, recipient, subject, message, status, errorMsg]
    );
  } catch (err) {
    logger.error('Failed to log notification:', err.message);
  }
};

// ── Send fire alert ──────────────────────────────────────────────
const sendFireAlert = async (incident, device) => {
  const incCode = incident.incident_code || incident.id;
  const severity = (incident.severity || '').toUpperCase();
  const location = device.location_label || device.device_code;
  const time = new Date().toISOString();
  const smoke = incident.smoke_ppm ? `${incident.smoke_ppm} ppm` : 'N/A';
  const temp = incident.temperature_c ? `${incident.temperature_c}°C` : 'N/A';

  const subject = `🔥 [${severity}] Fire Detected — ${incCode}`;
  const textBody = `
SFDAASS FIRE ALERT
══════════════════
Incident: ${incCode}
Severity: ${severity}
Location: ${location}
Device:   ${device.device_code}
Time:     ${time}
Smoke:    ${smoke}
Temp:     ${temp}
GPS:      ${incident.gps_lat || 'N/A'}, ${incident.gps_lng || 'N/A'}
Geofence: ${incident.inside_geofence ? 'INSIDE ✓' : 'OUTSIDE ✗'}
Sprinkler: ${incident.sprinkler_activated ? 'ACTIVATED 💧' : 'STANDBY'}

ACCESS DASHBOARD: ${process.env.FRONTEND_URL || 'http://localhost:3000'}
  `.trim();

  const htmlBody = `
<div style="font-family:monospace;background:#0c1520;color:#e8f4fd;padding:24px;border-radius:8px;border:2px solid #ff4e1a">
  <h2 style="color:#ff4e1a;margin:0 0 16px">🔥 ${subject}</h2>
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="color:#7a9ab8;padding:4px 8px">Incident</td><td style="padding:4px 8px;color:#00d4aa">${incCode}</td></tr>
    <tr><td style="color:#7a9ab8;padding:4px 8px">Severity</td><td style="padding:4px 8px;color:#ff4e1a;font-weight:bold">${severity}</td></tr>
    <tr><td style="color:#7a9ab8;padding:4px 8px">Location</td><td style="padding:4px 8px">${location}</td></tr>
    <tr><td style="color:#7a9ab8;padding:4px 8px">Device</td><td style="padding:4px 8px">${device.device_code}</td></tr>
    <tr><td style="color:#7a9ab8;padding:4px 8px">Time</td><td style="padding:4px 8px">${time}</td></tr>
    <tr><td style="color:#7a9ab8;padding:4px 8px">Smoke Level</td><td style="padding:4px 8px;color:#ff4e1a">${smoke}</td></tr>
    <tr><td style="color:#7a9ab8;padding:4px 8px">Temperature</td><td style="padding:4px 8px;color:#ffaa00">${temp}</td></tr>
    <tr><td style="color:#7a9ab8;padding:4px 8px">Sprinkler</td><td style="padding:4px 8px;color:#00d4aa">${incident.sprinkler_activated ? '💧 ACTIVATED' : 'STANDBY'}</td></tr>
  </table>
  <p style="margin-top:16px"><a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}" style="color:#1e90ff">View Dashboard →</a></p>
</div>`;

  const transport = getTransport();

  // Fetch device-specific contacts
  let deviceContacts = [];
  try {
    const res = await query('SELECT channel, recipient FROM device_alert_contacts WHERE device_id=$1', [device.id]);
    if (res && res.rows) deviceContacts = res.rows;
  } catch (e) { }

  const deviceEmails = deviceContacts.filter(c => c.channel === 'email').map(c => c.recipient);
  const devicePhones = deviceContacts.filter(c => c.channel === 'sms').map(c => c.recipient);

  // Global fallbacks + device specifics
  const baseEmails = [process.env.ADMIN_EMAIL].filter(Boolean);
  const recipients = [...new Set([...baseEmails, ...deviceEmails])];

  for (const email of recipients) {
    try {
      await transport.sendMail({
        from: process.env.ALERT_EMAIL_FROM || 'SFDAASS <alerts@sfdaass.io>',
        to: email,
        subject,
        text: textBody,
        html: htmlBody,
      });
      await logNotification(incident.id, 'email', email, subject, textBody, 'sent');
    } catch (err) {
      logger.error(`Email alert failed for ${email}: ${err.message}`);
      await logNotification(incident.id, 'email', email, subject, textBody, 'failed', err.message);
    }
  }

  // SMS
  const basePhones = (process.env.ALERT_PHONE_NUMBERS || '').split(',').map(s => s.trim()).filter(Boolean);
  // Add the user requested default phone number
  basePhones.push('+265993925581');
  const phones = [...new Set([...basePhones, ...devicePhones])];
  const smsBody = `SFDAASS ALERT: ${severity} fire at ${location}. Incident ${incCode}. Smoke:${smoke} Temp:${temp}. Check dashboard immediately.`;

  for (const phone of phones) {
    const result = await sendSMS(phone, smsBody);
    await logNotification(
      incident.id, 'sms', phone, 'Fire Alert', smsBody,
      result.success ? 'sent' : 'failed',
      result.error || null
    );
  }
};

// ── Send contact reply confirmation ─────────────────────────────
const sendContactConfirmation = async (name, email, subject) => {
  const transport = getTransport();
  try {
    await transport.sendMail({
      from: process.env.ALERT_EMAIL_FROM || 'SFDAASS <no-reply@sfdaass.io>',
      to: email,
      subject: `Re: ${subject} — SFDAASS`,
      text: `Hi ${name},\n\nThank you for contacting the SFDAASS team. We have received your message and will respond within 24 hours.\n\nSFDAASS Support Team`,
    });
  } catch (err) {
    logger.warn(`Contact confirmation email failed: ${err.message}`);
  }
};

// ── Send weekly summary email ─────────────────────────────────────
const sendWeeklySummary = async (emails, incidents) => {
  const transport = getTransport();
  const summaryText = `SFDAASS Weekly Report\nTotal incidents past 7 days: ${incidents.length}`;
  try {
    await transport.sendMail({
      from: process.env.ALERT_EMAIL_FROM || 'SFDAASS <no-reply@sfdaass.io>',
      to: emails,
      subject: `SFDAASS Weekly Summary Report`,
      text: summaryText,
    });
    logger.info('Weekly summary email sent successfully.');
  } catch (err) {
    logger.warn(`Weekly summary email failed: ${err.message}`);
  }
};

// ── Send password reset email ─────────────────────────────────────
const sendPasswordResetEmail = async (email, name, token) => {
  const transport = getTransport();
  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}?resetToken=${token}`;
  const subject = '🔒 SFDAASS — Password Reset Request';
  const textBody = `Hi ${name},\n\nYou requested a password reset. Please click the link below to set a new password. This link is valid for 1 hour.\n\n${resetUrl}\n\nIf you did not request this, please ignore this email.`;
  
  const htmlBody = `
<div style="font-family:sans-serif;background:#0c1520;color:#e8f4fd;padding:24px;border-radius:8px">
  <h2 style="color:#00d4aa;margin:0 0 16px">Password Reset Request</h2>
  <p>Hi ${name},</p>
  <p>You requested a password reset for your SFDAASS account. Click the button below to set a new password. This link will expire in <strong>1 hour</strong>.</p>
  <div style="margin:32px 0">
    <a href="${resetUrl}" style="background:#00d4aa;color:#0c1520;padding:12px 24px;border-radius:4px;text-decoration:none;font-weight:bold;display:inline-block">Reset Password</a>
  </div>
  <p style="font-size:12px;color:#a0aec0">If the button doesn't work, copy and paste this link: ${resetUrl}</p>
  <hr style="border:none;border-top:1px solid #2d3748;margin:24px 0">
  <p style="font-size:12px;color:#a0aec0">SFDAASS Safety System — Secure Identity Service</p>
</div>`;

  try {
    await transport.sendMail({
      from: process.env.ALERT_EMAIL_FROM || 'SFDAASS <no-reply@sfdaass.io>',
      to: email,
      subject: subject,
      text: textBody,
      html: htmlBody,
    });
    logger.info(`Password reset email sent to ${email}`);
    return { success: true };
  } catch (err) {
    logger.error(`Password reset email failed for ${email}: ${err.message}`);
    return { success: false, error: err.message };
  }
};

module.exports = {
  sendFireAlert,
  sendContactConfirmation,
  sendSMS,
  sendWeeklySummary,
  sendPasswordResetEmail
};
