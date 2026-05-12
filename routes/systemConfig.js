// routes/systemConfig.js
const router = require('express').Router();
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

router.get('/thresholds', requireAdmin, (req, res) => {
  const rows = db.all('SELECT key, value FROM system_config');
  const thresholds = {};
  rows.forEach(r => { thresholds[r.key] = isNaN(r.value) ? r.value : parseFloat(r.value); });
  res.json({ success: true, thresholds });
});

router.put('/thresholds', requireAdmin, (req, res) => {
  const allowed = ['smoke_warning','smoke_critical','temp_warning','temp_critical','gas_warning','gas_critical','confirm_duration_ms'];
  Object.entries(req.body).forEach(([k, v]) => {
    if (allowed.includes(k)) {
      db.run("INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, datetime('now'))", [k, String(v)]);
    }
  });
  res.json({ success: true });
});

module.exports = router;
