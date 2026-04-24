// ════════════════════════════════════════════════════════════════
// routes/sprinklers.js
// ════════════════════════════════════════════════════════════════
const express = require('express');
const sprinklerRouter = express.Router();
const { query, queryOne, queryAll } = require('../database/db');
const bcrypt = require('bcryptjs');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');

let _io = null;
const setIO = (io) => { _io = io; };
const emit = (e, d) => { if (_io) _io.emit(e, d); };

// GET all zones
sprinklerRouter.get('/', authenticate, async (req, res) => {
  try {
    const zones = await queryAll('SELECT * FROM sprinkler_zones ORDER BY zone_code');
    res.json({ success: true, zones });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// POST activate zone
sprinklerRouter.post('/:zoneCode/activate', authenticate, authorize('admin', 'operator'), async (req, res) => {
  try {
    const { incident_id } = req.body;
    const zone = await queryOne(
      `UPDATE sprinkler_zones SET status='active', last_activated=NOW(), activated_by=$1
       WHERE zone_code=$2 RETURNING *`,
      [req.user.name, req.params.zoneCode]
    );
    if (!zone) return res.status(404).json({ success: false, message: 'Zone not found' });

    await query(
      `INSERT INTO sprinkler_activations (zone_id, incident_id, trigger_type, activated_by)
       VALUES ($1,$2,'manual',$3)`,
      [zone.id, incident_id || null, req.user.name]
    );

    emit('sprinkler:activated', { zone: zone.zone_code, by: req.user.name });
    res.json({ success: true, zone });
  } catch (err) {
    logger.error('Activate sprinkler error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST deactivate zone
sprinklerRouter.post('/:zoneCode/deactivate', authenticate, authorize('admin', 'operator'), async (req, res) => {
  try {
    const zone = await queryOne(
      `UPDATE sprinkler_zones SET status='standby', last_deactivated=NOW()
       WHERE zone_code=$1 RETURNING *`,
      [req.params.zoneCode]
    );
    if (!zone) return res.status(404).json({ success: false, message: 'Zone not found' });

    await query(
      `UPDATE sprinkler_activations SET deactivated_at=NOW()
       WHERE zone_id=$1 AND deactivated_at IS NULL`,
      [zone.id]
    );

    emit('sprinkler:deactivated', { zone: zone.zone_code, by: req.user.name });
    res.json({ success: true, zone });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET activation history
sprinklerRouter.get('/history', authenticate, async (req, res) => {
  try {
    const rows = await queryAll(
      `SELECT sa.*, sz.zone_code, sz.name AS zone_name
       FROM sprinkler_activations sa JOIN sprinkler_zones sz ON sz.id=sa.zone_id
       ORDER BY sa.activated_at DESC LIMIT 100`
    );
    res.json({ success: true, history: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ════════════════════════════════════════════════════════════════
// routes/geofence.js
// ════════════════════════════════════════════════════════════════
const geofenceRouter = express.Router();

geofenceRouter.get('/', authenticate, async (req, res) => {
  try {
    const geofences = await queryAll('SELECT * FROM geofences ORDER BY created_at DESC');
    res.json({ success: true, geofences });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

geofenceRouter.get('/active', authenticate, async (req, res) => {
  try {
    const gf = await queryOne('SELECT * FROM geofences WHERE is_active=TRUE ORDER BY created_at DESC LIMIT 1');
    res.json({ success: true, geofence: gf });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

geofenceRouter.post('/', authenticate, authorize('admin', 'operator'), async (req, res) => {
  try {
    const { name, type, center_lat, center_lng, radius_meters, polygon_coords } = req.body;
    if (type === 'circle' && (!center_lat || !center_lng || !radius_meters)) {
      return res.status(400).json({ success: false, message: 'Circle geofence requires center_lat, center_lng, radius_meters' });
    }
    if (type === 'polygon' && (!polygon_coords || polygon_coords.length < 3)) {
      return res.status(400).json({ success: false, message: 'Polygon requires at least 3 coordinates' });
    }

    // Deactivate existing
    await query('UPDATE geofences SET is_active=FALSE');

    const gf = await queryOne(
      `INSERT INTO geofences (name, type, center_lat, center_lng, radius_meters, polygon_coords, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7) RETURNING *`,
      [name || 'Main Facility', type, center_lat, center_lng, radius_meters,
       polygon_coords ? JSON.stringify(polygon_coords) : null, req.user.id]
    );

    if (_io) _io.emit('geofence:updated', gf);
    res.status(201).json({ success: true, geofence: gf });
  } catch (err) {
    logger.error('Create geofence error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

geofenceRouter.patch('/:id', authenticate, authorize('admin', 'operator'), async (req, res) => {
  try {
    const { name, center_lat, center_lng, radius_meters, polygon_coords, is_active } = req.body;
    const gf = await queryOne(
      `UPDATE geofences SET
         name=COALESCE($1,name), center_lat=COALESCE($2,center_lat),
         center_lng=COALESCE($3,center_lng), radius_meters=COALESCE($4,radius_meters),
         polygon_coords=COALESCE($5::jsonb,polygon_coords), is_active=COALESCE($6,is_active)
       WHERE id=$7 RETURNING *`,
      [name, center_lat, center_lng, radius_meters,
       polygon_coords ? JSON.stringify(polygon_coords) : null, is_active, req.params.id]
    );
    if (!gf) return res.status(404).json({ success: false, message: 'Geofence not found' });
    if (_io) _io.emit('geofence:updated', gf);
    res.json({ success: true, geofence: gf });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ════════════════════════════════════════════════════════════════
// routes/users.js
// ════════════════════════════════════════════════════════════════
const usersRouter = express.Router();

usersRouter.get('/', authenticate, authorize('admin'), async (req, res) => {
  try {
    const users = await queryAll(
      'SELECT id, name, email, role, phone, is_active, last_login, created_at FROM users ORDER BY created_at'
    );
    res.json({ success: true, users });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

usersRouter.patch('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { name, role, phone, is_active } = req.body;
    const user = await queryOne(
      `UPDATE users SET name=COALESCE($1,name), role=COALESCE($2,role),
         phone=COALESCE($3,phone), is_active=COALESCE($4,is_active)
       WHERE id=$5 RETURNING id, name, email, role, phone, is_active`,
      [name, role, phone, is_active, req.params.id]
    );
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

usersRouter.post('/', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { name, email, password, role, phone } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const existing = await queryOne('SELECT id FROM users WHERE email=$1', [email]);
    if (existing) return res.status(409).json({ success: false, message: 'Email already exists' });

    const hash = await bcrypt.hash(password, 12);
    const user = await queryOne(
      'INSERT INTO users (name, email, password_hash, role, phone) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, email, role, phone',
      [name, email, hash, role, phone]
    );

    // Audit log
    await query('INSERT INTO audit_log (user_id, action, details) VALUES ($1,$2,$3)',
      [req.user.id, 'create_user', JSON.stringify({ created_user_email: email, role })]);

    res.status(201).json({ success: true, user });
  } catch (err) {
    logger.error('Create user error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

usersRouter.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    if (id === req.user.id) {
      return res.status(400).json({ success: false, message: 'Cannot delete yourself' });
    }

    const user = await queryOne('DELETE FROM users WHERE id=$1 RETURNING id, name, email', [id]);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Audit log
    await query('INSERT INTO audit_log (user_id, action, details) VALUES ($1,$2,$3)',
      [req.user.id, 'delete_user', JSON.stringify({ deleted_user_email: user.email })]);

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (err) {
    logger.error('Delete user error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ════════════════════════════════════════════════════════════════
// routes/contact.js
// ════════════════════════════════════════════════════════════════
const contactRouter = express.Router();
const { sendContactConfirmation } = require('../utils/notifications');

contactRouter.post('/', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ success: false, message: 'Name, email and message are required' });
    }

    const msg = await queryOne(
      'INSERT INTO contact_messages (name, email, subject, message) VALUES ($1,$2,$3,$4) RETURNING id',
      [name.trim(), email.trim(), subject || 'General Inquiry', message.trim()]
    );

    await sendContactConfirmation(name, email, subject || 'General Inquiry');
    res.status(201).json({ success: true, id: msg.id, message: 'Message sent successfully' });
  } catch (err) {
    logger.error('Contact submit error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

contactRouter.get('/', authenticate, authorize('admin'), async (req, res) => {
  try {
    const msgs = await queryAll('SELECT * FROM contact_messages ORDER BY created_at DESC');
    res.json({ success: true, messages: msgs });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// ════════════════════════════════════════════════════════════════
// routes/dashboard.js  — aggregated stats for dashboard
// ════════════════════════════════════════════════════════════════
const dashboardRouter = express.Router();

dashboardRouter.get('/stats', authenticate, async (req, res) => {
  try {
    const [incStats, deviceStats, sprinklerZones, activeIncidents, recentReadings] =
      await Promise.all([
        queryOne('SELECT * FROM v_incident_stats'),
        queryOne(`SELECT
          COUNT(*) FILTER (WHERE dt.status='online') AS online,
          COUNT(*) FILTER (WHERE dt.status='offline') AS offline,
          COUNT(*) FILTER (WHERE dt.status='warning') AS warning,
          COUNT(*) AS total
          FROM devices d LEFT JOIN device_telemetry dt ON dt.device_id=d.id
          WHERE d.is_active=TRUE`),
        queryAll(`SELECT zone_code, name, status, last_activated FROM sprinkler_zones ORDER BY zone_code`),
        queryAll(`SELECT * FROM v_active_incidents LIMIT 5`),
        queryAll(`SELECT sr.smoke_ppm, sr.temperature_c, sr.gas_ppm, sr.humidity_pct,
                         sr.flame_detected, sr.recorded_at, d.device_code
                  FROM sensor_readings sr JOIN devices d ON d.id=sr.device_id
                  ORDER BY sr.recorded_at DESC LIMIT 20`),
      ]);

    res.json({
      success: true,
      incidents: incStats,
      devices: deviceStats,
      sprinklerZones,
      activeIncidents,
      recentReadings,
    });
  } catch (err) {
    logger.error('Dashboard stats error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

dashboardRouter.get('/chart-data', authenticate, async (req, res) => {
  try {
    const { deviceCode, hours = 24 } = req.query;
    let deviceFilter = '';
    const params = [parseInt(hours)];

    if (deviceCode) {
      const d = await queryOne('SELECT id FROM devices WHERE device_code=$1', [deviceCode]);
      if (d) { deviceFilter = ' AND sr.device_id=$2'; params.push(d.id); }
    }

    const readings = await queryAll(
      `SELECT
         DATE_TRUNC('hour', recorded_at) AS hour,
         AVG(smoke_ppm)::NUMERIC(8,1) AS avg_smoke,
         MAX(smoke_ppm)::NUMERIC(8,1) AS max_smoke,
         AVG(temperature_c)::NUMERIC(5,1) AS avg_temp,
         MAX(temperature_c)::NUMERIC(5,1) AS max_temp,
         AVG(gas_ppm)::NUMERIC(8,1) AS avg_gas,
         COUNT(*) AS reading_count
       FROM sensor_readings sr
       WHERE recorded_at >= NOW() - INTERVAL '${parseInt(hours)} hours'
       ${deviceFilter}
       GROUP BY hour ORDER BY hour`,
      params
    );

    res.json({ success: true, chartData: readings });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ════════════════════════════════════════════════════════════════
// routes/systemConfig.js
// ════════════════════════════════════════════════════════════════
const systemConfigRouter = express.Router();

systemConfigRouter.get('/thresholds', authenticate, authorize('admin', 'operator'), async (req, res) => {
  try {
    const config = await queryOne(`SELECT value FROM system_config WHERE key='thresholds'`);
    if (!config) return res.status(404).json({ success: false, message: 'Thresholds not found' });
    res.json({ success: true, thresholds: config.value });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

systemConfigRouter.put('/thresholds', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { smoke_warning, smoke_critical, temp_warning, temp_critical, gas_warning, gas_critical, confirm_duration_ms } = req.body;
    const value = { smoke_warning, smoke_critical, temp_warning, temp_critical, gas_warning, gas_critical, confirm_duration_ms };
    const config = await queryOne(
      `UPDATE system_config SET value=$1::jsonb, updated_by=$2, updated_at=NOW() WHERE key='thresholds' RETURNING value`,
      [JSON.stringify(value), req.user.id]
    );
    res.json({ success: true, thresholds: config.value });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ════════════════════════════════════════════════════════════════
// routes/audit.js
// ════════════════════════════════════════════════════════════════
const auditRouter = express.Router();

auditRouter.get('/', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const logs = await queryAll(
      `SELECT a.*, u.name as user_name FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = {
  sprinklerRouter, setSpIO: setIO,
  geofenceRouter,
  usersRouter,
  contactRouter,
  dashboardRouter,
  systemConfigRouter,
  auditRouter,
};
