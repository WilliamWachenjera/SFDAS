// routes/dashboard.js
// GET /api/dashboard/stats
// GET /api/dashboard/chart-data

const router = require('express').Router();
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

// GET /api/dashboard/stats
router.get('/stats', requireAuth, (req, res) => {
  const isOperator = req.user.role === 'operator';
  let deviceFilter = '';
  let params = [];
  let assigned = [];

  if (isOperator) {
    const user = db.get('SELECT assigned_devices FROM users WHERE id = ?', [req.user.id]);
    assigned = JSON.parse(user.assigned_devices || '[]');
    if (assigned.length === 0) {
      return res.json({ 
        success: true, 
        incidents: { active_count: 0, total: 0, today: 0, this_month: 0 },
        devices: { total: 0, online: 0, offline: 0, warning: 0 },
        sprinklerZones: [],
        activeIncidents: [],
        recentReadings: []
      });
    }
    const placeholders = assigned.map(() => '?').join(',');
    deviceFilter = ` AND i.device_code IN (${placeholders})`;
    params = assigned;
  }

  const incidents = {
    active_count: db.get(`SELECT COUNT(*) as n FROM incidents i WHERE i.status IN ('active','monitoring','acknowledged')${deviceFilter}`, params).n,
    total: db.get(`SELECT COUNT(*) as n FROM incidents i WHERE 1=1${deviceFilter}`, params).n,
    today: db.get(`SELECT COUNT(*) as n FROM incidents i WHERE date(i.detected_at) = date('now')${deviceFilter}`, params).n,
    this_month: db.get(`SELECT COUNT(*) as n FROM incidents i WHERE strftime('%Y-%m', i.detected_at) = strftime('%Y-%m', 'now')${deviceFilter}`, params).n,
  };

  const devices = {
    total: db.get(`SELECT COUNT(*) as n FROM devices WHERE 1=1${isOperator ? ` AND device_code IN (${assigned.map(() => '?').join(',')})` : ''}`, isOperator ? assigned : []).n,
    online: db.get(`SELECT COUNT(*) as n FROM devices WHERE status = 'online'${isOperator ? ` AND device_code IN (${assigned.map(() => '?').join(',')})` : ''}`, isOperator ? assigned : []).n,
    offline: db.get(`SELECT COUNT(*) as n FROM devices WHERE status = 'offline'${isOperator ? ` AND device_code IN (${assigned.map(() => '?').join(',')})` : ''}`, isOperator ? assigned : []).n,
    warning: db.get(`SELECT COUNT(*) as n FROM devices WHERE status = 'warning'${isOperator ? ` AND device_code IN (${assigned.map(() => '?').join(',')})` : ''}`, isOperator ? assigned : []).n,
  };

  // Sprinkler zones usually assigned to devices
  const sprinklerZones = isOperator 
    ? db.all(`SELECT sz.* FROM sprinkler_zones sz JOIN devices d ON sz.device_id = d.id WHERE d.device_code IN (${assigned.map(() => '?').join(',')})`, assigned)
    : db.all('SELECT * FROM sprinkler_zones ORDER BY zone_code');

  const activeIncidents = db.all(`
    SELECT i.*, d.device_code, d.location_label as loc
    FROM incidents i
    LEFT JOIN devices d ON i.device_id = d.id
    WHERE i.status IN ('active','monitoring','acknowledged')${deviceFilter}
    ORDER BY i.detected_at DESC
    LIMIT 10
  `, params);

  const recentReadings = db.all(
    `SELECT * FROM sensor_readings WHERE 1=1${deviceFilter} ORDER BY recorded_at DESC LIMIT 5`,
    params
  );

  res.json({ success: true, incidents, devices, sprinklerZones, activeIncidents, recentReadings });
});

// GET /api/dashboard/chart-data?hours=24
router.get('/chart-data', requireAuth, (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const isOperator = req.user.role === 'operator';
  let deviceFilter = '';
  let params = [];
  let assigned = [];

  if (isOperator) {
    const user = db.get('SELECT assigned_devices FROM users WHERE id = ?', [req.user.id]);
    assigned = JSON.parse(user.assigned_devices || '[]');
    if (assigned.length === 0) return res.json({ success: true, chartData: [] });
    const placeholders = assigned.map(() => '?').join(',');
    deviceFilter = ` AND device_code IN (${placeholders})`;
    params = assigned;
  }

  // Hourly averages for charts
  const chartData = db.all(`
    SELECT
      strftime('%Y-%m-%dT%H:00:00', recorded_at) as hour,
      ROUND(AVG(smoke_ppm), 1) as avg_smoke,
      ROUND(AVG(temperature_c), 1) as avg_temp,
      ROUND(AVG(gas_ppm), 1) as avg_gas,
      ROUND(AVG(humidity_pct), 1) as avg_humidity
    FROM sensor_readings
    WHERE recorded_at >= datetime('now', '-${hours} hours')${deviceFilter}
    GROUP BY hour
    ORDER BY hour ASC
  `, params);

  res.json({ success: true, chartData });
});

module.exports = router;
