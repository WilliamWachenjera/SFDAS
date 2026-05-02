// routes/auditLogs.js
const router = require('express').Router();
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

router.get('/', requireAdmin, (req, res) => {
  let query = 'SELECT * FROM audit_logs';
  let params = [];
  if (req.query.userId) {
    query += ' WHERE user_id = ?';
    params.push(req.query.userId);
  }
  query += ' ORDER BY created_at DESC LIMIT 200';
  const logs = db.all(query, params);
  res.json({ success: true, logs });
});

router.delete('/', requireAdmin, (req, res) => {
  db.run('DELETE FROM audit_logs');
  res.json({ success: true });
});

router.delete('/:id', requireAdmin, (req, res) => {
  db.run('DELETE FROM audit_logs WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
