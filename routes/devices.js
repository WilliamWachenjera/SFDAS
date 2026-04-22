// routes/devices.js

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { requireAuth, requireAdmin, requireOperator, logAudit } = require('../middleware/auth');

// GET /api/devices
router.get('/', requireAuth, (req, res) => {
  // Update seconds_since_seen
  db.run(`UPDATE devices SET seconds_since_seen = CAST((julianday('now') - julianday(last_seen)) * 86400 AS INTEGER) WHERE last_seen IS NOT NULL`);
  db.run(`UPDATE devices SET status = 'offline' WHERE seconds_since_seen > 120 AND status != 'offline'`);

  const devices = db.all('SELECT * FROM devices ORDER BY last_seen DESC');
  res.json({ success: true, devices });
});

// GET /api/devices/:id
router.get('/:id', requireAuth, (req, res) => {
  const d = db.get('SELECT * FROM devices WHERE id = ? OR device_code = ?', [req.params.id, req.params.id]);
  if (!d) return res.status(404).json({ success: false, message: 'Device not found' });
  res.json({ success: true, device: d });
});

// POST /api/devices — Register new device
router.post('/', requireOperator, (req, res) => {
  const { device_code, name, location_label, mac_address, firmware_version } = req.body;
  if (!device_code) return res.status(400).json({ success: false, message: 'device_code required' });

  const existing = db.get('SELECT id FROM devices WHERE device_code = ?', [device_code]);
  if (existing) return res.status(409).json({ success: false, message: 'Device code already registered' });

  const apiKey = uuidv4();
  const result = db.run(
    'INSERT INTO devices (device_code, name, location_label, mac_address, firmware_version, api_key, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [device_code, name || device_code, location_label || '', mac_address || '', firmware_version || '1.0.0', apiKey, 'offline']
  );

  logAudit(db, { userId: req.user.id, userName: req.user.name, action: 'device_registered', details: { device_code }, ip: req.ip });

  const device = db.get('SELECT * FROM devices WHERE id = ?', [result.lastID]);
  res.status(201).json({ success: true, device: { ...device, api_key: apiKey } });
});

// PATCH /api/devices/:id
router.patch('/:id', requireOperator, (req, res) => {
  const { name, location_label, geofence_id } = req.body;
  db.run(
    'UPDATE devices SET name = COALESCE(?, name), location_label = COALESCE(?, location_label), geofence_id = COALESCE(?, geofence_id) WHERE id = ? OR device_code = ?',
    [name, location_label, geofence_id, req.params.id, req.params.id]
  );
  res.json({ success: true });
});

// GET /api/devices/:id/readings?hours=24
router.get('/:id/readings', requireAuth, (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const readings = db.all(
    `SELECT * FROM sensor_readings WHERE device_code = ? AND recorded_at >= datetime('now', '-${hours} hours') ORDER BY recorded_at ASC`,
    [req.params.id]
  );
  res.json({ success: true, readings });
});

// POST /api/devices/:id/sprinkler — Manual sprinkler control
router.post('/:deviceCode/sprinkler', requireOperator, (req, res) => {
  const { activate } = req.body;
  const mqttClient = require('../services/mqttService').getClient();
  if (mqttClient?.connected) {
    mqttClient.publish(`sfdaass/sprinkler/${req.params.deviceCode}`, JSON.stringify({ activate, source: 'api' }));
  }
  logAudit(db, { userId: req.user.id, userName: req.user.name, action: activate ? 'sprinkler_activate' : 'sprinkler_deactivate', details: { deviceCode: req.params.deviceCode }, ip: req.ip });
  res.json({ success: true, activate });
});

// POST /api/devices/:deviceCode/config — Push config to ESP32
router.post('/:deviceCode/config', requireOperator, (req, res) => {
  const mqttClient = require('../services/mqttService').getClient();
  if (mqttClient?.connected) {
    mqttClient.publish(`sfdaass/config/${req.params.deviceCode}`, JSON.stringify(req.body));
  }
  res.json({ success: true, message: 'Config pushed to device' });
});

module.exports = router;
