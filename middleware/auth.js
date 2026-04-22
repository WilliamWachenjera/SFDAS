// middleware/auth.js

const jwt = require('jsonwebtoken');
const db = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET || 'sfdaass-secret';
const ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '2h';
const REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '7d';

function signAccessToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_EXPIRY });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, JWT_SECRET + '-refresh', { expiresIn: REFRESH_EXPIRY });
}

function verifyAccessToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, JWT_SECRET + '-refresh');
}

// Express middleware
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace('Bearer ', '');
  if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch (e) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin access required' });
    next();
  });
}

function requireOperator(req, res, next) {
  requireAuth(req, res, () => {
    if (!['admin', 'operator'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Operator or admin access required' });
    }
    next();
  });
}

// Log to audit table
function logAudit(db, { userId, userName, action, details, ip }) {
  try {
    db.run(
      'INSERT INTO audit_logs (user_id, user_name, action, details, ip_address) VALUES (?, ?, ?, ?, ?)',
      [userId, userName, action, JSON.stringify(details || {}), ip || '']
    );
  } catch (e) {}
}

module.exports = {
  signAccessToken, signRefreshToken,
  verifyAccessToken, verifyRefreshToken,
  requireAuth, requireAdmin, requireOperator,
  logAudit,
};
