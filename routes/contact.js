// routes/contact.js
const router = require('express').Router();
const notifyService = require('../services/notifyService');

router.post('/', async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !message) return res.status(400).json({ success: false, message: 'Name, email and message required' });

  try {
    await notifyService.sendEmail({
      to: process.env.ADMIN_EMAIL || 'admin@sfdaass.io',
      subject: `[SFDAASS Contact] ${subject || 'General Inquiry'} from ${name}`,
      text: `From: ${name} <${email}>\n\n${message}`,
      html: `<b>From:</b> ${name} (${email})<br/><b>Subject:</b> ${subject}<br/><br/><p>${message}</p>`,
    });
    res.json({ success: true, message: 'Message sent' });
  } catch (e) {
    // Still return success so UX isn't broken even without email config
    res.json({ success: true, message: 'Message received' });
  }
});

module.exports = router;
