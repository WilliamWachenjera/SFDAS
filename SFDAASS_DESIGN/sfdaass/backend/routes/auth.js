const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const { query, queryOne } = require('../database/db');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');
const { sendPasswordResetEmail } = require('../utils/notifications');

const JWT_SECRET  = process.env.JWT_SECRET  || 'dev_secret';
const JWT_REFRESH = process.env.JWT_REFRESH_SECRET || 'dev_refresh';
const JWT_EXP     = process.env.JWT_EXPIRES_IN     || '7d';
const REFRESH_EXP = process.env.JWT_REFRESH_EXPIRES_IN || '30d';

const signAccess  = (user) => jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXP });
const signRefresh = (user) => jwt.sign({ id: user.id }, JWT_REFRESH, { expiresIn: REFRESH_EXP });

// ── POST /api/auth/login ─────────────────────────────────────────
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const { email, password } = req.body;
    const user = await queryOne(
      'SELECT id, name, email, password_hash, role, phone, is_active, login_attempts, locked_until FROM users WHERE email=$1',
      [email]
    );

    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    if (!user.is_active) return res.status(403).json({ success: false, message: 'Account deactivated' });

    // Check lock
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const mins = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
      return res.status(429).json({ success: false, message: `Account locked. Try again in ${mins} minutes.` });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      const attempts = user.login_attempts + 1;
      const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60000) : null;
      await query(
        'UPDATE users SET login_attempts=$1, locked_until=$2 WHERE id=$3',
        [attempts, lockUntil, user.id]
      );
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Reset attempts on success
    await query('UPDATE users SET login_attempts=0, locked_until=NULL, last_login=NOW() WHERE id=$1', [user.id]);

    const accessToken  = signAccess(user);
    const refreshToken = signRefresh(user);
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    await query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,NOW() + ($3)::INTERVAL)',
      [user.id, tokenHash, REFRESH_EXP.replace('d', ' days').replace('h', ' hours')]
    );

    // Audit log
    await query('INSERT INTO audit_log (user_id, action, ip_address) VALUES ($1,$2,$3)',
      [user.id, 'login', req.ip]);

    logger.info(`User logged in: ${user.email} (${user.role})`);

    res.json({
      success: true,
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone }
    });
  } catch (err) {
    logger.error('Login error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── POST /api/auth/register ──────────────────────────────────────
// Restricted to administrators
router.post('/register', authenticate, authorize('admin'), [
  body('name').trim().isLength({ min: 2, max: 100 }),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9])/),
  body('role').optional().isIn(['admin','operator','viewer']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const { name, email, password, role = 'viewer', phone } = req.body;

    const existing = await queryOne('SELECT id FROM users WHERE email=$1', [email]);
    if (existing) return res.status(409).json({ success: false, message: 'Email already registered' });

    const hash = await bcrypt.hash(password, 12);
    const user = await queryOne(
      'INSERT INTO users (name,email,password_hash,role,phone) VALUES ($1,$2,$3,$4,$5) RETURNING id,name,email,role',
      [name, email, hash, role, phone]
    );

    const accessToken = signAccess(user);
    logger.info(`New user registered: ${email} (${role})`);

    res.status(201).json({ success: true, accessToken, user });
  } catch (err) {
    logger.error('Register error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── POST /api/auth/refresh ───────────────────────────────────────
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ success: false, message: 'Refresh token required' });

    const decoded = jwt.verify(refreshToken, JWT_REFRESH);
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    const stored = await queryOne(
      'SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash=$1 AND user_id=$2',
      [hash, decoded.id]
    );

    if (!stored || stored.revoked_at || new Date(stored.expires_at) < new Date()) {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
    }

    const user = await queryOne('SELECT id, name, email, role FROM users WHERE id=$1 AND is_active=true', [decoded.id]);
    if (!user) return res.status(401).json({ success: false, message: 'User not found' });

    // Rotate refresh token
    await query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE id=$1', [stored.id]);
    const newRefresh = signRefresh(user);
    const newHash = crypto.createHash('sha256').update(newRefresh).digest('hex');
    await query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,NOW()+INTERVAL $3)',
      [user.id, newHash, REFRESH_EXP.replace('d', ' days')]
    );

    res.json({
      success: true,
      accessToken: signAccess(user),
      refreshToken: newRefresh,
    });
  } catch (err) {
    res.status(401).json({ success: false, message: 'Invalid refresh token' });
  }
});

// ── POST /api/auth/logout ────────────────────────────────────────
router.post('/logout', authenticate, async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      await query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE token_hash=$1', [hash]);
    }
    await query('INSERT INTO audit_log (user_id, action, ip_address) VALUES ($1,$2,$3)',
      [req.user.id, 'logout', req.ip]);
    res.json({ success: true, message: 'Logged out' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  const user = await queryOne(
    'SELECT id, name, email, role, phone, last_login, created_at FROM users WHERE id=$1',
    [req.user.id]
  );
  res.json({ success: true, user });
});

// ── PATCH /api/auth/change-password ──────────────────────────────
router.patch('/change-password', authenticate, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 8 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const { currentPassword, newPassword } = req.body;
    const user = await queryOne('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(400).json({ success: false, message: 'Current password incorrect' });

    const hash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.user.id]);
    // Revoke all refresh tokens
    await query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL', [req.user.id]);

    res.json({ success: true, message: 'Password changed. Please log in again.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── POST /api/auth/forgot-password ───────────────────────────────
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const { email } = req.body;
    const user = await queryOne('SELECT id, name, email FROM users WHERE email=$1', [email]);
    
    // Always return success to prevent email enumeration, but only send if user exists
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 3600000); // 1 hour

      await query(
        'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)',
        [user.id, token, expires]
      );

      await sendPasswordResetEmail(user.email, user.name, token);
      
      // Audit log
      await query('INSERT INTO audit_log (user_id, action, details) VALUES ($1,$2,$3)',
        [user.id, 'password_reset_request', JSON.stringify({ email: user.email })]);
    }

    res.json({ success: true, message: 'If an account exists with that email, a password reset link has been sent.' });
  } catch (err) {
    logger.error('Forgot password error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── POST /api/auth/reset-password ────────────────────────────────
router.post('/reset-password', [
  body('token').notEmpty(),
  body('newPassword').isLength({ min: 8 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const { token, newPassword } = req.body;

    const resetReq = await queryOne(
      'SELECT id, user_id FROM password_reset_tokens WHERE token=$1 AND expires_at > NOW() AND used_at IS NULL',
      [token]
    );

    if (!resetReq) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, resetReq.user_id]);
    
    // Mark token as used
    await query('UPDATE password_reset_tokens SET used_at=NOW() WHERE id=$1', [resetReq.id]);
    
    // Revoke all current sessions/refresh tokens for security
    await query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL', [resetReq.user_id]);

    // Audit log
    await query('INSERT INTO audit_log (user_id, action) VALUES ($1,$2)', [resetReq.user_id, 'password_reset_success']);

    res.json({ success: true, message: 'Password has been reset successfully. You can now log in.' });
  } catch (err) {
    logger.error('Reset password error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
