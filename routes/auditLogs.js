// routes/auditLogs.js
const router = require('express').Router();
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

router.get('/', requireAdmin, async (req, res) => {
  try {
    let query = 'SELECT * FROM audit_logs';
    let params = [];
    if (req.query.userId) {
      query += ' WHERE user_id = ?';
      params.push(req.query.userId);
    }
    query += ' ORDER BY created_at DESC LIMIT 200';
    const logs = await db.all(query, params);
    res.json({ success: true, logs });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.delete('/', requireAdmin, async (req, res) => {
  try {
    await db.run('DELETE FROM audit_logs');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await db.run('DELETE FROM audit_logs WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
