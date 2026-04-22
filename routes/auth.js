// routes/auth.js

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { signAccessToken, signRefreshToken, verifyRefreshToken, requireAuth, logAudit } = require('../middleware/auth');
const notifyService = require('../services/notifyService');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password required' });

  const user = db.get('SELECT * FROM users WHERE email = ? AND is_active = 1', [email.toLowerCase().trim()]);
  if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) return res.status(401).json({ success: false, message: 'Invalid credentials' });

  // Update last login
  db.run('UPDATE users SET last_login = datetime("now") WHERE id = ?', [user.id]);

  const payload = { id: user.id, email: user.email, role: user.role, name: user.name };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  // Store refresh token
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.run('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)', [user.id, refreshToken, expiresAt]);

  logAudit(db, { userId: user.id, userName: user.name, action: 'login', ip: req.ip });

  res.json({
    success: true,
    accessToken,
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone },
  });
});

// POST /api/auth/logout
router.post('/logout', requireAuth, (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) db.run('DELETE FROM refresh_tokens WHERE token = ?', [refreshToken]);
  logAudit(db, { userId: req.user.id, userName: req.user.name, action: 'logout', ip: req.ip });
  res.json({ success: true });
});

// POST /api/auth/refresh
router.post('/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ success: false, message: 'Refresh token required' });

  try {
    const payload = verifyRefreshToken(refreshToken);
    const stored = db.get(
      'SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > datetime("now")',
      [refreshToken]
    );
    if (!stored) return res.status(401).json({ success: false, message: 'Refresh token expired or invalid' });

    const user = db.get('SELECT * FROM users WHERE id = ? AND is_active = 1', [payload.id]);
    if (!user) return res.status(401).json({ success: false, message: 'User not found' });

    // Rotate tokens
    db.run('DELETE FROM refresh_tokens WHERE token = ?', [refreshToken]);
    const newPayload = { id: user.id, email: user.email, role: user.role, name: user.name };
    const newAccessToken = signAccessToken(newPayload);
    const newRefreshToken = signRefreshToken(newPayload);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.run('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)', [user.id, newRefreshToken, expiresAt]);

    res.json({ success: true, accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (e) {
    res.status(401).json({ success: false, message: 'Invalid refresh token' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const user = db.get('SELECT * FROM users WHERE email = ?', [email?.toLowerCase()]);

  // Always respond success (don't reveal if email exists)
  res.json({ success: true, message: 'If that email is registered, a reset link has been sent.' });

  if (!user) return;

  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
  db.run('DELETE FROM password_reset_tokens WHERE user_id = ?', [user.id]);
  db.run('INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)', [user.id, token, expiresAt]);

  const resetUrl = `http://localhost:${process.env.PORT || 5000}/?resetToken=${token}`;
  await notifyService.sendEmail({
    to: user.email,
    subject: '[SFDAASS] Password Reset Request',
    text: `Click to reset your password:\n\n${resetUrl}\n\nThis link expires in 1 hour.`,
    html: `<p>Click to reset your SFDAASS password:</p><a href="${resetUrl}" style="background:#ff4e1a;color:white;padding:10px 20px;text-decoration:none;border-radius:5px">Reset Password</a><p>Expires in 1 hour.</p>`,
  }).catch(() => {});
});

// POST /api/auth/reset-password
router.post('/reset-password', (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ success: false, message: 'Token and new password required' });
  if (newPassword.length < 8) return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });

  const record = db.get(
    'SELECT * FROM password_reset_tokens WHERE token = ? AND expires_at > datetime("now") AND used = 0',
    [token]
  );
  if (!record) return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });

  const hash = bcrypt.hashSync(newPassword, 10);
  db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, record.user_id]);
  db.run('UPDATE password_reset_tokens SET used = 1 WHERE token = ?', [token]);

  res.json({ success: true, message: 'Password updated successfully' });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const user = db.get('SELECT id, name, email, role, phone, created_at FROM users WHERE id = ?', [req.user.id]);
  res.json({ success: true, user });
});

module.exports = router;
