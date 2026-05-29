// routes/dashboard.js
// GET /api/dashboard/stats
// GET /api/dashboard/chart-data

const router = require('express').Router();
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

// GET /api/dashboard/stats
router.get('/stats', requireAuth, async (req, res) => {
  const isOperator = req.user.role === 'operator';
  let deviceFilter = '';
  let params = [];
  let assigned = [];

  try {
    if (isOperator) {
      const user = await db.get('SELECT assigned_devices FROM users WHERE id = ?', [req.user.id]);
      assigned = JSON.parse(user?.assigned_devices || '[]');
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

    const activeCountRes = await db.get(`SELECT COUNT(*) as n FROM incidents i WHERE i.status IN ('active','monitoring','acknowledged')${deviceFilter}`, params);
    const totalRes = await db.get(`SELECT COUNT(*) as n FROM incidents i WHERE 1=1${deviceFilter}`, params);
    const todayRes = await db.get(`SELECT COUNT(*) as n FROM incidents i WHERE DATE(i.detected_at) = CURRENT_DATE${deviceFilter}`, params);
    const thisMonthRes = await db.get(`SELECT COUNT(*) as n FROM incidents i WHERE TO_CHAR(i.detected_at, 'YYYY-MM') = TO_CHAR(NOW(), 'YYYY-MM')${deviceFilter}`, params);

    const incidents = {
      active_count: parseInt(activeCountRes?.n || 0),
      total: parseInt(totalRes?.n || 0),
      today: parseInt(todayRes?.n || 0),
      this_month: parseInt(thisMonthRes?.n || 0),
    };

    const devTotalRes = await db.get(`SELECT COUNT(*) as n FROM devices WHERE 1=1${isOperator ? ` AND device_code IN (${assigned.map(() => '?').join(',')})` : ''}`, isOperator ? assigned : []);
    const devOnlineRes = await db.get(`SELECT COUNT(*) as n FROM devices WHERE status = 'online'${isOperator ? ` AND device_code IN (${assigned.map(() => '?').join(',')})` : ''}`, isOperator ? assigned : []);
    const devOfflineRes = await db.get(`SELECT COUNT(*) as n FROM devices WHERE status = 'offline'${isOperator ? ` AND device_code IN (${assigned.map(() => '?').join(',')})` : ''}`, isOperator ? assigned : []);
    const devWarningRes = await db.get(`SELECT COUNT(*) as n FROM devices WHERE status = 'warning'${isOperator ? ` AND device_code IN (${assigned.map(() => '?').join(',')})` : ''}`, isOperator ? assigned : []);

    const devices = {
      total: parseInt(devTotalRes?.n || 0),
      online: parseInt(devOnlineRes?.n || 0),
      offline: parseInt(devOfflineRes?.n || 0),
      warning: parseInt(devWarningRes?.n || 0),
    };

    // Sprinkler zones usually assigned to devices
    const sprinklerZones = isOperator 
      ? await db.all(`SELECT sz.* FROM sprinkler_zones sz JOIN devices d ON sz.device_id = d.id WHERE d.device_code IN (${assigned.map(() => '?').join(',')})`, assigned)
      : await db.all('SELECT * FROM sprinkler_zones ORDER BY zone_code');

    const activeIncidents = await db.all(`
      SELECT i.*, d.device_code, d.location_label as loc
      FROM incidents i
      LEFT JOIN devices d ON i.device_id = d.id
      WHERE i.status IN ('active','monitoring','acknowledged')${deviceFilter}
      ORDER BY i.detected_at DESC
      LIMIT 10
    `, params);

    const recentReadings = await db.all(
      `SELECT * FROM sensor_readings WHERE 1=1${deviceFilter} ORDER BY recorded_at DESC LIMIT 5`,
      params
    );

    res.json({ success: true, incidents, devices, sprinklerZones, activeIncidents, recentReadings });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/dashboard/chart-data?hours=24
router.get('/chart-data', requireAuth, async (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const isOperator = req.user.role === 'operator';
  let deviceFilter = '';
  let params = [];
  let assigned = [];

  try {
    if (isOperator) {
      const user = await db.get('SELECT assigned_devices FROM users WHERE id = ?', [req.user.id]);
      assigned = JSON.parse(user?.assigned_devices || '[]');
      if (assigned.length === 0) return res.json({ success: true, chartData: [] });
      const placeholders = assigned.map(() => '?').join(',');
      deviceFilter = ` AND device_code IN (${placeholders})`;
      params = assigned;
    }

    // Hourly averages for charts
    // Note: ROUND in PostgreSQL requires numeric type, so we cast average results.
    const chartData = await db.all(`
      SELECT
        TO_CHAR(recorded_at, 'YYYY-MM-DD"T"HH24:00:00') as hour,
        ROUND(AVG(smoke_ppm)::numeric, 1) as avg_smoke,
        ROUND(AVG(temperature_c)::numeric, 1) as avg_temp,
        ROUND((AVG(flame_detected::double precision) * 100)::numeric, 1) as avg_gas,
        ROUND(AVG(humidity_pct)::numeric, 1) as avg_humidity
      FROM sensor_readings
      WHERE recorded_at >= NOW() - INTERVAL '${hours} hours'${deviceFilter}
      GROUP BY hour
      ORDER BY hour ASC
    `, params);

    res.json({ success: true, chartData });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
