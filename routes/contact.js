// routes/contact.js
const router = require('express').Router();
const notifyService = require('../services/notifyService');
const db = require('../db/database');

router.post('/', async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !message) return res.status(400).json({ success: false, message: 'Name, email and message required' });

  const admin = db.get("SELECT email FROM users WHERE role = 'admin' LIMIT 1");
  const targetEmail = admin ? admin.email : (process.env.ADMIN_EMAIL || 'admin@sfdaass.io');

  notifyService.sendEmail({

    to: targetEmail,
    subject: `[SFDAASS Contact] ${subject || 'General Inquiry'} from ${name}`,
    text: `From: ${name} <${email}>\n\n${message}`,
    html: `<b>From:</b> ${name} (${email})<br/><b>Subject:</b> ${subject}<br/><br/><p>${message}</p>`,
  }).catch(e => console.error('Contact email failed:', e));

  res.json({ success: true, message: 'Message sent' });
});


module.exports = router;
