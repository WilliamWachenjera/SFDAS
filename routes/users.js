// routes/users.js
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { requireAdmin, logAudit } = require('../middleware/auth');

router.get('/', requireAdmin, (req, res) => {
  const users = db.all('SELECT id, name, email, role, phone, is_active, last_login, created_at FROM users ORDER BY created_at DESC');
  res.json({ success: true, users });
});

router.post('/', requireAdmin, (req, res) => {
  const { name, email, password, role, phone } = req.body;
  if (!name || !email || !password) return res.status(400).json({ success: false, message: 'Name, email and password required' });

  const exists = db.get('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
  if (exists) return res.status(409).json({ success: false, message: 'Email already registered' });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.run(
    'INSERT INTO users (name, email, password_hash, role, phone) VALUES (?, ?, ?, ?, ?)',
    [name, email.toLowerCase(), hash, role || 'viewer', phone || null]
  );
  logAudit(db, { userId: req.user.id, userName: req.user.name, action: 'user_created', details: { email }, ip: req.ip });
  res.status(201).json({ success: true, user: db.get('SELECT id, name, email, role FROM users WHERE id = ?', [result.lastID]) });
});

router.patch('/:id', requireAdmin, (req, res) => {
  const { name, role, phone, is_active } = req.body;
  db.run(
    'UPDATE users SET name = COALESCE(?, name), role = COALESCE(?, role), phone = COALESCE(?, phone), is_active = COALESCE(?, is_active) WHERE id = ?',
    [name, role, phone, is_active, req.params.id]
  );
  logAudit(db, { userId: req.user.id, userName: req.user.name, action: 'user_updated', details: { targetId: req.params.id }, ip: req.ip });
  res.json({ success: true });
});

router.delete('/:id', requireAdmin, (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ success: false, message: 'Cannot delete yourself' });
  db.run('DELETE FROM users WHERE id = ?', [req.params.id]);
  logAudit(db, { userId: req.user.id, userName: req.user.name, action: 'user_deleted', details: { targetId: req.params.id }, ip: req.ip });
  res.json({ success: true });
});

module.exports = router;
