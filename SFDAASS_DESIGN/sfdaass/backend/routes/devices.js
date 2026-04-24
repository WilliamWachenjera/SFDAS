const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const { query, queryOne, queryAll } = require('../database/db');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');

// ── GET /api/devices ─────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const rows = await queryAll(`SELECT * FROM v_device_dashboard`);
    res.json({ success: true, devices: rows });
  } catch (err) {
    logger.error('Get devices error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── GET /api/devices/:id ─────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const device = await queryOne(
      `SELECT d.*, dt.status, dt.last_seen, dt.smoke_ppm, dt.temperature_c,
              dt.gas_ppm, dt.humidity_pct, dt.flame_detected, dt.gps_lat, dt.gps_lng,
              dt.inside_geofence, dt.battery_pct, dt.rssi, dt.uptime_seconds
       FROM devices d LEFT JOIN device_telemetry dt ON dt.device_id=d.id
       WHERE d.id=$1 OR d.device_code=$1`,
      [req.params.id]
    );
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, device });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── POST /api/devices ────────────────────────────────────────────
router.post('/', authenticate, authorize('admin', 'operator'), [
  body('device_code').trim().isLength({ min: 3, max: 20 }),
  body('name').optional().trim(),
  body('location_label').optional().trim(),
  body('geofence_id').optional().isUUID(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const { device_code, name, location_label, firmware_version, mac_address, geofence_id } = req.body;
    const api_key = crypto.randomBytes(32).toString('hex');

    const existing = await queryOne('SELECT id FROM devices WHERE device_code=$1', [device_code]);
    if (existing) return res.status(409).json({ success: false, message: 'Device code already registered' });

    const device = await queryOne(
      `INSERT INTO devices (device_code, name, location_label, firmware_version, mac_address, api_key, geofence_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [device_code, name, location_label, firmware_version || '1.0.0', mac_address, api_key, geofence_id]
    );

    logger.info(`Device registered: ${device_code} by ${req.user.email}`);
    res.status(201).json({ success: true, device: { ...device, api_key } });
  } catch (err) {
    logger.error('Register device error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── PATCH /api/devices/:id ───────────────────────────────────────
router.patch('/:id', authenticate, authorize('admin', 'operator'), async (req, res) => {
  try {
    const { name, location_label, firmware_version, geofence_id, is_active } = req.body;
    const device = await queryOne(
      `UPDATE devices SET
         name=COALESCE($1,name), location_label=COALESCE($2,location_label),
         firmware_version=COALESCE($3,firmware_version), geofence_id=COALESCE($4,geofence_id),
         is_active=COALESCE($5,is_active)
       WHERE id=$6 RETURNING *`,
      [name, location_label, firmware_version, geofence_id, is_active, req.params.id]
    );
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, device });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── DELETE /api/devices/:id ──────────────────────────────────────
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const result = await query('UPDATE devices SET is_active=FALSE WHERE id=$1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, message: 'Device deactivated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── POST /api/devices/:id/regenerate-key ─────────────────────────
router.post('/:id/regenerate-key', authenticate, authorize('admin'), async (req, res) => {
  try {
    const api_key = crypto.randomBytes(32).toString('hex');
    const device = await queryOne('UPDATE devices SET api_key=$1 WHERE id=$2 RETURNING device_code', [api_key, req.params.id]);
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, api_key, message: `New API key for ${device.device_code}` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
