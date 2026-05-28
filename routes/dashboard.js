// routes/dashboard.js
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
      const user = await db.get('SELECT assigned_devices FROM users WHERE id = $1', [req.user.id]);
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
      
      const placeholders = assigned.map((_, i) => `$${i + 1}`).join(',');
      deviceFilter = ` AND i.device_code IN (${placeholders})`;
      params = assigned;
    }

    const activeCountRes = await db.get(
      `SELECT COUNT(*) as n FROM incidents i WHERE i.status IN ('active','monitoring','acknowledged')${deviceFilter}`, 
      params
    );
    
    const totalRes = await db.get(`SELECT COUNT(*) as n FROM incidents i WHERE 1=1${deviceFilter}`, params);
    const todayRes = await db.get(`SELECT COUNT(*) as n FROM incidents i WHERE DATE(i.detected_at) = CURRENT_DATE${deviceFilter}`, params);
    const thisMonthRes = await db.get(
      `SELECT COUNT(*) as n FROM incidents i WHERE TO_CHAR(i.detected_at, 'YYYY-MM') = TO_CHAR(NOW(), 'YYYY-MM')${deviceFilter}`, 
      params
    );

    const incidents = {
      active_count: parseInt(activeCountRes?.n || 0),
      total: parseInt(totalRes?.n || 0),
      today: parseInt(todayRes?.n || 0),
      this_month: parseInt(thisMonthRes?.n || 0),
    };

    // Devices stats
    const devParams    = isOperator ? assigned : [];
    // devWhereFilter: used when no WHERE clause exists yet (devTotalRes)
    // devAndFilter:   used when WHERE already exists (status queries)
    const devWhereFilter = isOperator ? ` WHERE device_code IN (${assigned.map((_, i) => `$${i+1}`).join(',')})` : '';
    const devAndFilter   = isOperator ? ` AND device_code IN (${assigned.map((_, i) => `$${i+1}`).join(',')})` : '';

    const devTotalRes   = await db.get(`SELECT COUNT(*) as n FROM devices${devWhereFilter}`, devParams);
    const devOnlineRes  = await db.get(`SELECT COUNT(*) as n FROM devices WHERE status = 'online'${devAndFilter}`, devParams);
    const devOfflineRes = await db.get(`SELECT COUNT(*) as n FROM devices WHERE status = 'offline'${devAndFilter}`, devParams);
    const devWarningRes = await db.get(`SELECT COUNT(*) as n FROM devices WHERE status = 'warning'${devAndFilter}`, devParams);

    const devices = {
      total: parseInt(devTotalRes?.n || 0),
      online: parseInt(devOnlineRes?.n || 0),
      offline: parseInt(devOfflineRes?.n || 0),
      warning: parseInt(devWarningRes?.n || 0),
    };

    // Sprinkler zones
    const sprinklerZones = isOperator 
      ? await db.all(
          `SELECT sz.* FROM sprinkler_zones sz 
           JOIN devices d ON sz.device_id = d.id 
           WHERE d.device_code IN (${assigned.map((_, i) => `$${i+1}`).join(',')})`, 
          assigned
        )
      : await db.all('SELECT * FROM sprinkler_zones ORDER BY zone_code');

    // Active incidents
    const activeIncidents = await db.all(`
      SELECT i.*, d.device_code, d.location_label as loc
      FROM incidents i
      LEFT JOIN devices d ON i.device_id = d.id
      WHERE i.status IN ('active','monitoring','acknowledged')${deviceFilter}
      ORDER BY i.detected_at DESC
      LIMIT 10
    `, params);

    // Recent readings
    // NOTE: sensor_readings has no alias, so we cannot use the 'i.device_code'
    // alias from the incidents deviceFilter — build a dedicated filter here.
    const sensorFilter = isOperator
      ? ` AND device_code IN (${assigned.map((_, i) => `$${i + 1}`).join(',')})` : '';
    const recentReadings = await db.all(
      `SELECT * FROM sensor_readings WHERE 1=1${sensorFilter} ORDER BY recorded_at DESC LIMIT 5`,
      params
    );

    res.json({ success: true, incidents, devices, sprinklerZones, activeIncidents, recentReadings });
  } catch (e) {
    console.error(e);
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
      const user = await db.get('SELECT assigned_devices FROM users WHERE id = $1', [req.user.id]);
      assigned = JSON.parse(user?.assigned_devices || '[]');
      if (assigned.length === 0) return res.json({ success: true, chartData: [] });
      
      const placeholders = assigned.map((_, i) => `$${i + 1}`).join(',');
      deviceFilter = ` AND device_code IN (${placeholders})`;
      params = assigned;
    }

    const chartData = await db.all(`
      SELECT
        TO_CHAR(recorded_at, 'YYYY-MM-DD"T"HH24:00:00') as hour,
        ROUND(AVG(smoke_ppm)::numeric, 1) as avg_smoke,
        ROUND(AVG(temperature_c)::numeric, 1) as avg_temp,
        ROUND(AVG(flame_detected * 100)::numeric, 1) as flame_freq,
        ROUND(AVG(humidity_pct)::numeric, 1) as avg_humidity
      FROM sensor_readings
      WHERE recorded_at >= NOW() - INTERVAL '${hours} hours'${deviceFilter}
      GROUP BY hour
      ORDER BY hour ASC
    `, params);

    res.json({ success: true, chartData });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;