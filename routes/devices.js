// routes/devices.js
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { requireAuth, requireAdmin, requireOperator, logAudit } = require('../middleware/auth');
const { pushConfigToDevice } = require('../services/mqttService');

// GET /api/devices
router.get('/', requireAuth, async (req, res) => {
  try {
    // Update device status
    await db.query(`UPDATE devices SET seconds_since_seen = EXTRACT(EPOCH FROM (NOW() - last_seen))::INTEGER WHERE last_seen IS NOT NULL`);
    await db.query(`UPDATE devices SET status = 'offline' WHERE seconds_since_seen > 120 AND status != 'offline'`);

    let query = 'SELECT * FROM devices ORDER BY last_seen DESC';
    let params = [];

    if (req.user.role === 'operator') {
      const user = await db.get('SELECT assigned_devices FROM users WHERE id = $1', [req.user.id]);
      let allowed = [];
      try { allowed = JSON.parse(user?.assigned_devices || '[]'); } catch (e) {}

      if (allowed.length === 0) {
        return res.json({ success: true, devices: [] });
      }
      
      const placeholders = allowed.map((_, i) => `$${i + 1}`).join(',');
      query = `SELECT * FROM devices WHERE device_code IN (${placeholders}) ORDER BY last_seen DESC`;
      params = allowed;
    }

    const devices = await db.all(query, params);
    res.json({ success: true, devices });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/devices/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    let d;
    const idNum = parseInt(req.params.id);
    
    if (!isNaN(idNum) && String(idNum) === req.params.id) {
      d = await db.get('SELECT * FROM devices WHERE id = $1 OR device_code = $2', [idNum, req.params.id]);
    } else {
      d = await db.get('SELECT * FROM devices WHERE device_code = $1', [req.params.id]);
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
    const existing = await db.get('SELECT id FROM devices WHERE device_code = $1', [device_code]);
    if (existing) return res.status(409).json({ success: false, message: 'Device code already registered' });

    const apiKey = uuidv4();

    const result = await db.query(
      `INSERT INTO devices (
        device_code, name, location_label, mac_address, firmware_version, 
        api_key, status, gps_lat, gps_lng, location, owner_name, owner_email, owner_phone
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 
        CASE WHEN $8 IS NOT NULL AND $9 IS NOT NULL 
             THEN ST_SetSRID(ST_MakePoint($9, $8), 4326) 
             ELSE NULL END, 
        $10, $11, $12) RETURNING id`,
      [
        device_code, 
        name || device_code, 
        location_label || '', 
        mac_address || '', 
        firmware_version || '1.0.0', 
        apiKey, 
        'offline', 
        gps_lat || null, 
        gps_lng || null,
        owner_name || '', 
        owner_email || '', 
        owner_phone || ''
      ]
    );

    await logAudit(db, { 
      userId: req.user.id, 
      userName: req.user.name, 
      action: 'device_registered', 
      details: { device_code }, 
      ip: req.ip 
    });

    const device = await db.get('SELECT * FROM devices WHERE id = $1', [result.rows[0].id]);
    res.status(201).json({ success: true, device: { ...device, api_key: apiKey } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// PATCH /api/devices/:id
router.patch('/:id', requireOperator, async (req, res) => {
  const { name, location_label, geofence_id } = req.body;
  try {
    const idNum = parseInt(req.params.id);
    if (!isNaN(idNum) && String(idNum) === req.params.id) {
      await db.query(
        'UPDATE devices SET name = COALESCE($1, name), location_label = COALESCE($2, location_label), geofence_id = COALESCE($3, geofence_id) WHERE id = $4 OR device_code = $5',
        [name, location_label, geofence_id, idNum, req.params.id]
      );
    } else {
      await db.query(
        'UPDATE devices SET name = COALESCE($1, name), location_label = COALESCE($2, location_label), geofence_id = COALESCE($3, geofence_id) WHERE device_code = $4',
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
      device = await db.get('SELECT id, device_code FROM devices WHERE id = $1 OR device_code = $2', [idNum, req.params.id]);
    } else {
      device = await db.get('SELECT id, device_code FROM devices WHERE device_code = $1', [req.params.id]);
    }

    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

    await db.query('DELETE FROM devices WHERE id = $1', [device.id]);
    await db.query('DELETE FROM sensor_readings WHERE device_code = $1', [device.device_code]);

    await logAudit(db, { 
      userId: req.user.id, 
      userName: req.user.name, 
      action: 'device_deleted', 
      details: { device_code: device.device_code }, 
      ip: req.ip 
    });
    
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
      `SELECT * FROM sensor_readings WHERE device_code = $1 AND recorded_at >= NOW() - ($2 || ' hours')::INTERVAL ORDER BY recorded_at ASC`,
      [req.params.id, hours]
    );
    res.json({ success: true, readings });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/devices/:deviceCode/sprinkler
router.post('/:deviceCode/sprinkler', requireOperator, async (req, res) => {
  const { activate } = req.body;
  try {
    // FIX: check connection state and return 503 instead of silently doing nothing
    const mqttClient = require('../services/mqttService').getClient();
    if (!mqttClient || !mqttClient.connected) {
      return res.status(503).json({ success: false, message: 'MQTT broker not connected — sprinkler command not sent' });
    }
    mqttClient.publish(
      `sfdaass/sprinkler/${req.params.deviceCode}`,
      JSON.stringify({ activate, source: 'api' }),
      { qos: 1 }
    );
    await logAudit(db, { 
      userId: req.user.id, 
      userName: req.user.name, 
      action: activate ? 'sprinkler_activate' : 'sprinkler_deactivate', 
      details: { deviceCode: req.params.deviceCode }, 
      ip: req.ip 
    });
    res.json({ success: true, activate });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});


// POST /api/devices/:deviceCode/config  — Push threshold config to a physical device via MQTT
// Called by the dashboard's "Push Config" button (submitDeviceConfig in index.html)
router.post('/:deviceCode/config', requireOperator, async (req, res) => {
  try {
    const { deviceCode } = req.params;

    // Verify the device actually exists (by ID or device_code) before attempting a push
    let device;
    const idNum = parseInt(deviceCode);
    if (!isNaN(idNum) && String(idNum) === deviceCode) {
      device = await db.get('SELECT id, device_code FROM devices WHERE id = $1 OR device_code = $2', [idNum, deviceCode]);
    } else {
      device = await db.get('SELECT id, device_code FROM devices WHERE device_code = $1', [deviceCode]);
    }
    
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

    const {
      smoke_warning   = 250,  smoke_critical   = 500,
      temp_warning    = 50,   temp_critical    = 100,
      gas_warning     = 150,  gas_critical     = 300,
      humidity_warning = 70,  humidity_critical = 90,
    } = req.body;

    const config = {
      smoke_warning, smoke_critical,
      temp_warning,  temp_critical,
      gas_warning,   gas_critical,
      humidity_warning, humidity_critical,
    };

    // Publish to sfdaass/config/<device_code> (QoS 1, retained)
    const sent = pushConfigToDevice(device.device_code, config);
    if (!sent) {
      return res.status(503).json({ success: false, message: 'MQTT broker not connected — config not pushed' });
    }

    await logAudit(db, {
      userId:   req.user.id,
      userName: req.user.name,
      action:   'device_config_push',
      details:  { deviceCode: device.device_code, config },
      ip:       req.ip,
    });

    res.json({ success: true, message: `Config pushed to ${device.device_code}` });
  } catch (e) {
    console.error('[devices/config]', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;