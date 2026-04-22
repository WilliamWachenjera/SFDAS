// routes/auth.js

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const logger = require('../services/logger');
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

  if (!user) {
    logger.warn(`Password reset requested for non-existent email: ${email}`);
    return;
  }

  logger.info(`Attempting to send password reset email to: ${user.email} (ID: ${user.id})`);

  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
  db.run('DELETE FROM password_reset_tokens WHERE user_id = ?', [user.id]);
  db.run('INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)', [user.id, token, expiresAt]);

  const protocol = req.protocol === 'http' && req.headers['x-forwarded-proto'] ? req.headers['x-forwarded-proto'] : req.protocol;
  const host = req.get('host');
  const baseUrl = `${protocol}://${host}`;
  const resetUrl = `${baseUrl}/?resetToken=${token}`;

  await notifyService.sendEmail({
    to: user.email,
    subject: '[SFDAASS] Password Reset Request',
    text: `You requested a password reset for your SFDAASS account. Click the link below to set a new password:\n\n${resetUrl}\n\nThis link expires in 1 hour.`,
    html: `
      <div style="background-color:#060a0f; color:#e8f4fd; font-family:sans-serif; padding:40px; border-radius:12px; max-width:600px; margin:0 auto;">
        <div style="text-align:center; margin-bottom:30px;">
          <h1 style="color:#ff4e1a; margin:0; letter-spacing:4px; font-size:28px;">SFDAASS</h1>
          <p style="color:#7a9ab8; font-size:12px; text-transform:uppercase; margin-top:5px; letter-spacing:2px;">Smart Fire Detection & Alerting</p>
        </div>
        <div style="background-color:#0c1520; padding:30px; border-radius:8px; border:1px solid #1a3045;">
          <h2 style="color:#e8f4fd; margin-top:0;">Reset Your Password</h2>
          <p style="color:#7a9ab8; line-height:1.6;">A password reset was requested for your account. If you did not make this request, you can safely ignore this email.</p>
          <div style="text-align:center; margin:35px 0;">
            <a href="${resetUrl}" style="background:linear-gradient(135deg, #ff4e1a, #c03000); color:white; padding:14px 30px; text-decoration:none; border-radius:6px; font-weight:bold; display:inline-block; font-size:16px;">SECURELY RESET PASSWORD</a>
          </div>
          <p style="color:#3d5a70; font-size:12px; text-align:center;">This link will expire in 60 minutes for your security.</p>
        </div>
        <div style="text-align:center; margin-top:30px; color:#3d5a70; font-size:11px;">
          <p>© 2026 SFDAASS — Automated Suppression Systems</p>
        </div>
      </div>
    `,
  }).catch((err) => {
    logger.error('Failed to send reset email:', err);
  });
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
