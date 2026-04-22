// routes/auditLogs.js
const router = require('express').Router();
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

router.get('/', requireAdmin, (req, res) => {
  const logs = db.all('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200');
  res.json({ success: true, logs });
});

module.exports = router;
