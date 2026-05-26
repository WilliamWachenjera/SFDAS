// routes/systemConfig.js
const router = require('express').Router();
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

router.get('/thresholds', requireAdmin, async (req, res) => {
  try {
    const rows = await db.all('SELECT key, value FROM system_config');
    const thresholds = {};
    rows.forEach(r => { thresholds[r.key] = isNaN(r.value) ? r.value : parseFloat(r.value); });
    res.json({ success: true, thresholds });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.put('/thresholds', requireAdmin, async (req, res) => {
  const allowed = ['smoke_warning','smoke_critical','temp_warning','temp_critical','gas_warning','gas_critical','confirm_duration_ms'];
  try {
    for (const [k, v] of Object.entries(req.body)) {
      if (allowed.includes(k)) {
        await db.run(
          "INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()",
          [k, String(v)]
        );
      }
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
