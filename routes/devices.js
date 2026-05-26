// routes/devices.js

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { requireAuth, requireAdmin, requireOperator, logAudit } = require('../middleware/auth');

// GET /api/devices
router.get('/', requireAuth, async (req, res) => {
  try {
    // Update seconds_since_seen and status using PostgreSQL syntax
    await db.run(`UPDATE devices SET seconds_since_seen = EXTRACT(EPOCH FROM (NOW() - last_seen))::INTEGER WHERE last_seen IS NOT NULL`);
    await db.run(`UPDATE devices SET status = 'offline' WHERE seconds_since_seen > 120 AND status != 'offline'`);

    let query = 'SELECT * FROM devices ORDER BY last_seen DESC';
    let params = [];

    if (req.user.role === 'operator') {
      const user = await db.get('SELECT assigned_devices FROM users WHERE id = ?', [req.user.id]);
      let allowed = [];
      try { allowed = JSON.parse(user?.assigned_devices || '[]'); } catch (e) {}

      if (allowed.length === 0) {
        return res.json({ success: true, devices: [] });
      }
      const placeholders = allowed.map(() => '?').join(',');
      query = `SELECT * FROM devices WHERE device_code IN (${placeholders}) ORDER BY last_seen DESC`;
      params = allowed;
    }

    const devices = await db.all(query, params);
    res.json({ success: true, devices });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/devices/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    let d;
    const idNum = parseInt(req.params.id);
    if (!isNaN(idNum) && String(idNum) === req.params.id) {
      d = await db.get('SELECT * FROM devices WHERE id = ? OR device_code = ?', [idNum, req.params.id]);
    } else {
      d = await db.get('SELECT * FROM devices WHERE device_code = ?', [req.params.id]);
    }

    if (!d) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, device: d });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/devices — Register new device
router.post('/', requireOperator, async (req, res) => {
  const { 
    device_code, name, location_label, mac_address, firmware_version, 
    gps_lat, gps_lng, owner_name, owner_email, owner_phone 
  } = req.body;
  if (!device_code) return res.status(400).json({ success: false, message: 'device_code required' });

  try {
    const existing = await db.get('SELECT id FROM devices WHERE device_code = ?', [device_code]);
    if (existing) return res.status(409).json({ success: false, message: 'Device code already registered' });

    const apiKey = uuidv4();
    // Using PostgreSQL ST_SetSRID and ST_MakePoint for spatial location
    const result = await db.run(
      `INSERT INTO devices (
        device_code, name, location_label, mac_address, firmware_version, 
        api_key, status, gps_lat, gps_lng, location, owner_name, owner_email, owner_phone
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 
        CASE WHEN ? IS NOT NULL AND ? IS NOT NULL THEN ST_SetSRID(ST_MakePoint(?, ?), 4326) ELSE NULL END, 
        ?, ?, ?) RETURNING id`,
      [
        device_code, name || device_code, location_label || '', mac_address || '', firmware_version || '1.0.0', 
        apiKey, 'offline', gps_lat || null, gps_lng || null, 
        gps_lng || null, gps_lat || null, gps_lng || null, gps_lat || null,
        owner_name || '', owner_email || '', owner_phone || ''
      ]
    );

    await logAudit(db, { userId: req.user.id, userName: req.user.name, action: 'device_registered', details: { device_code }, ip: req.ip });

    const device = await db.get('SELECT * FROM devices WHERE id = ?', [result.lastID]);
    res.status(201).json({ success: true, device: { ...device, api_key: apiKey } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// PATCH /api/devices/:id
router.patch('/:id', requireOperator, async (req, res) => {
  const { name, location_label, geofence_id } = req.body;
  try {
    const idNum = parseInt(req.params.id);
    if (!isNaN(idNum) && String(idNum) === req.params.id) {
      await db.run(
        'UPDATE devices SET name = COALESCE(?, name), location_label = COALESCE(?, location_label), geofence_id = COALESCE(?, geofence_id) WHERE id = ? OR device_code = ?',
        [name, location_label, geofence_id, idNum, req.params.id]
      );
    } else {
      await db.run(
        'UPDATE devices SET name = COALESCE(?, name), location_label = COALESCE(?, location_label), geofence_id = COALESCE(?, geofence_id) WHERE device_code = ?',
        [name, location_label, geofence_id, req.params.id]
      );
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// DELETE /api/devices/:id
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const idNum = parseInt(req.params.id);
    let device;
    if (!isNaN(idNum) && String(idNum) === req.params.id) {
      device = await db.get('SELECT id, device_code FROM devices WHERE id = ? OR device_code = ?', [idNum, req.params.id]);
    } else {
      device = await db.get('SELECT id, device_code FROM devices WHERE device_code = ?', [req.params.id]);
    }

    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

    await db.run('DELETE FROM devices WHERE id = ?', [device.id]);
    await db.run('DELETE FROM sensor_readings WHERE device_code = ?', [device.device_code]);

    await logAudit(db, { userId: req.user.id, userName: req.user.name, action: 'device_deleted', details: { device_code: device.device_code }, ip: req.ip });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/devices/:id/readings?hours=24
router.get('/:id/readings', requireAuth, async (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  try {
    const readings = await db.all(
      `SELECT * FROM sensor_readings WHERE device_code = ? AND recorded_at >= NOW() - INTERVAL '${hours} hours' ORDER BY recorded_at ASC`,
      [req.params.id]
    );
    res.json({ success: true, readings });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/devices/:deviceCode/sprinkler — Manual sprinkler control
router.post('/:deviceCode/sprinkler', requireOperator, async (req, res) => {
  const { activate } = req.body;
  try {
    const mqttClient = require('../services/mqttService').getClient();
    if (mqttClient?.connected) {
      mqttClient.publish(`sfdaass/sprinkler/${req.params.deviceCode}`, JSON.stringify({ activate, source: 'api' }));
    }
    await logAudit(db, { userId: req.user.id, userName: req.user.name, action: activate ? 'sprinkler_activate' : 'sprinkler_deactivate', details: { deviceCode: req.params.deviceCode }, ip: req.ip });
    res.json({ success: true, activate });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/devices/:deviceCode/config — Push config to ESP32
router.post('/:deviceCode/config', requireOperator, async (req, res) => {
  try {
    if (req.user.role === 'operator') {
      const user = await db.get('SELECT assigned_devices FROM users WHERE id = ?', [req.user.id]);
      let allowed = [];
      try { allowed = JSON.parse(user?.assigned_devices || '[]'); } catch (e) {}
      if (!allowed.includes(req.params.deviceCode)) {
        return res.status(403).json({ success: false, message: 'Not authorized to configure this device' });
      }
    }

    const mqttClient = require('../services/mqttService').getClient();
    if (mqttClient?.connected) {
      mqttClient.publish(`sfdaass/config/${req.params.deviceCode}`, JSON.stringify(req.body));
    }
    await logAudit(db, { userId: req.user.id, userName: req.user.name, action: 'device_config_push', details: { deviceCode: req.params.deviceCode, payload: req.body }, ip: req.ip });
    res.json({ success: true, message: 'Config pushed to device' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
