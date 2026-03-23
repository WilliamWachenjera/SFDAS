const jwt = require('jsonwebtoken');
const { queryOne } = require('../database/db');
const logger = require('../utils/logger');

/**
 * Verify JWT access token.
 * Attaches req.user = { id, email, role, name }
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Access token required' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');

    // Verify user still exists and is active
    const user = await queryOne(
      'SELECT id, name, email, role, is_active FROM users WHERE id=$1',
      [decoded.id]
    );

    if (!user || !user.is_active) {
      return res.status(401).json({ success: false, message: 'User not found or deactivated' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    logger.error('Auth middleware error:', err.message);
    return res.status(500).json({ success: false, message: 'Authentication error' });
  }
};

/**
 * Role-based authorization factory
 * Usage: authorize('admin') or authorize('admin','operator')
 */
const authorize = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: `Access denied. Required roles: ${roles.join(', ')}`
    });
  }
  next();
};

/**
 * Device API key middleware
 * Devices authenticate with X-Device-Key header
 */
const authenticateDevice = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-device-key'];
    if (!apiKey) {
      return res.status(401).json({ success: false, message: 'Device API key required' });
    }

    const device = await queryOne(
      'SELECT id, device_code, location_label, geofence_id, is_active FROM devices WHERE api_key=$1',
      [apiKey]
    );

    if (!device || !device.is_active) {
      return res.status(401).json({ success: false, message: 'Invalid or inactive device key' });
    }

    req.device = device;
    next();
  } catch (err) {
    logger.error('Device auth error:', err.message);
    return res.status(500).json({ success: false, message: 'Device authentication error' });
  }
};

module.exports = { authenticate, authorize, authenticateDevice };
