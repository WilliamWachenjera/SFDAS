// routes/users.js
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { requireAdmin, logAudit } = require('../middleware/auth');
const notifyService = require('../services/notifyService');

router.get('/', requireAdmin, async (req, res) => {
  try {
    const users = await db.all('SELECT id, name, email, role, phone, is_active, last_login, created_at, assigned_devices FROM users ORDER BY created_at DESC');
    res.json({ success: true, users });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  const { name, email, password, role, phone, assigned_devices } = req.body;
  if (!name || !email || !password) return res.status(400).json({ success: false, message: 'Name, email and password required' });

  try {
    const exists = await db.get('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (exists) return res.status(409).json({ success: false, message: 'Email already registered' });

    const hash = bcrypt.hashSync(password, 10);
    const devicesStr = Array.isArray(assigned_devices) ? JSON.stringify(assigned_devices) : '[]';

    const result = await db.query(
      'INSERT INTO users (name, email, password_hash, role, phone, assigned_devices) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [name, email.toLowerCase(), hash, role || 'operator', phone || null, devicesStr]
    );

    await logAudit(db, { userId: req.user.id, userName: req.user.name, action: 'user_created', details: { email }, ip: req.ip });

    const userRecord = await db.get('SELECT id, name, email, role FROM users WHERE id = $1', [result.rows[0].id]);

    notifyService.sendEmail({
      to: email.toLowerCase(),
      subject: '[SFDAASS] Account Created',
      text: `Hello ${name},\n\nYour account has been created on the SFDAASS platform.\n\nRole: ${role || 'operator'}\nEmail: ${email.toLowerCase()}\nPassword: ${password}\n\nPlease login and change your password as soon as possible.\n\nBest regards,\nSFDAASS Team`,
      html: `
        <div style="background-color:#060a0f; color:#e8f4fd; font-family:sans-serif; padding:40px; border-radius:12px; max-width:600px; margin:0 auto;">
          <h2 style="color:#00d4aa;">Welcome to SFDAASS, ${name}!</h2>
          <p>Your account has been successfully created.</p>
          <p><strong>Role:</strong> ${role || 'operator'}<br>
          <strong>Email:</strong> ${email.toLowerCase()}<br>
          <strong>Password:</strong> ${password}</p>
          <p>Please log in and change your password as soon as possible.</p>
          <p style="color:#7a9ab8; font-size:12px;">SFDAASS System</p>
        </div>
      `
    }).catch(e => console.error('Failed to send welcome email:', e));

    res.status(201).json({ success: true, user: userRecord });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  const { name, role, phone, is_active, assigned_devices } = req.body;
  const devicesStr = Array.isArray(assigned_devices) ? JSON.stringify(assigned_devices) : null;

  try {
    await db.query(
      `UPDATE users SET 
        name = COALESCE($1, name), 
        role = COALESCE($2, role), 
        phone = COALESCE($3, phone), 
        is_active = COALESCE($4, is_active),
        assigned_devices = COALESCE($5, assigned_devices)
       WHERE id = $6`,
      [name, role, phone, is_active, devicesStr, req.params.id]
    );
    await logAudit(db, { userId: req.user.id, userName: req.user.name, action: 'user_updated', details: { targetId: req.params.id }, ip: req.ip });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ success: false, message: 'Cannot delete yourself' });
  try {
    await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    await logAudit(db, { userId: req.user.id, userName: req.user.name, action: 'user_deleted', details: { targetId: req.params.id }, ip: req.ip });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;