// routes/dashboard.js
// GET /api/dashboard/stats
// GET /api/dashboard/chart-data

const router = require('express').Router();
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

// GET /api/dashboard/stats
router.get('/stats', requireAuth, (req, res) => {
  const incidents = {
    active_count: db.get('SELECT COUNT(*) as n FROM incidents WHERE status IN ("active","monitoring","acknowledged")').n,
    total: db.get('SELECT COUNT(*) as n FROM incidents').n,
    today: db.get('SELECT COUNT(*) as n FROM incidents WHERE date(detected_at) = date("now")').n,
    this_month: db.get('SELECT COUNT(*) as n FROM incidents WHERE strftime("%Y-%m", detected_at) = strftime("%Y-%m", "now")').n,
  };

  const devices = {
    total: db.get('SELECT COUNT(*) as n FROM devices').n,
    online: db.get('SELECT COUNT(*) as n FROM devices WHERE status = "online"').n,
    offline: db.get('SELECT COUNT(*) as n FROM devices WHERE status = "offline"').n,
    warning: db.get('SELECT COUNT(*) as n FROM devices WHERE status = "warning"').n,
  };

  const sprinklerZones = db.all('SELECT * FROM sprinkler_zones ORDER BY zone_code');

  const activeIncidents = db.all(`
    SELECT i.*, d.device_code, d.location_label as loc
    FROM incidents i
    LEFT JOIN devices d ON i.device_id = d.id
    WHERE i.status IN ('active','monitoring','acknowledged')
    ORDER BY i.detected_at DESC
    LIMIT 10
  `);

  const recentReadings = db.all(
    'SELECT * FROM sensor_readings ORDER BY recorded_at DESC LIMIT 5'
  );

  res.json({ success: true, incidents, devices, sprinklerZones, activeIncidents, recentReadings });
});

// GET /api/dashboard/chart-data?hours=24
router.get('/chart-data', requireAuth, (req, res) => {
  const hours = parseInt(req.query.hours) || 24;

  // Hourly averages for charts
  const chartData = db.all(`
    SELECT
      strftime('%Y-%m-%dT%H:00:00', recorded_at) as hour,
      ROUND(AVG(smoke_ppm), 1) as avg_smoke,
      ROUND(AVG(temperature_c), 1) as avg_temp,
      ROUND(AVG(gas_ppm), 1) as avg_gas,
      ROUND(AVG(humidity_pct), 1) as avg_humidity
    FROM sensor_readings
    WHERE recorded_at >= datetime('now', '-${hours} hours')
    GROUP BY hour
    ORDER BY hour ASC
  `);

  res.json({ success: true, chartData });
});

module.exports = router;
