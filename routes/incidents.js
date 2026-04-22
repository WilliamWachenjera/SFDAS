// routes/incidents.js

const router = require('express').Router();
const db = require('../db/database');
const { requireAuth, requireOperator, logAudit } = require('../middleware/auth');

// GET /api/incidents?limit=50&days=90&status=active&severity=critical
router.get('/', requireAuth, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const days = parseInt(req.query.days) || 90;
  const status = req.query.status;
  const severity = req.query.severity;

  let sql = `
    SELECT i.*, d.device_code as dc
    FROM incidents i
    LEFT JOIN devices d ON i.device_id = d.id
    WHERE i.detected_at >= datetime('now', '-${days} days')
  `;
  const params = [];
  if (status) { sql += ' AND i.status = ?'; params.push(status); }
  if (severity) { sql += ' AND i.severity = ?'; params.push(severity); }
  sql += ' ORDER BY i.detected_at DESC LIMIT ?';
  params.push(limit);

  const incidents = db.all(sql, params);
  res.json({ success: true, incidents });
});

// GET /api/incidents/stats
router.get('/stats', requireAuth, (req, res) => {
  const stats = {
    total: db.get('SELECT COUNT(*) as n FROM incidents').n,
    active_count: db.get(`SELECT COUNT(*) as n FROM incidents WHERE status IN ('active','monitoring','acknowledged')`).n,
    resolved_count: db.get(`SELECT COUNT(*) as n FROM incidents WHERE status = 'resolved'`).n,
    this_month: db.get(`SELECT COUNT(*) as n FROM incidents WHERE strftime('%Y-%m', detected_at) = strftime('%Y-%m', 'now')`).n,
    avg_resolution_secs: db.get('SELECT AVG(resolution_secs) as n FROM incidents WHERE resolution_secs IS NOT NULL').n || 0,
    by_severity: db.all('SELECT severity, COUNT(*) as count FROM incidents GROUP BY severity'),
  };
  res.json({ success: true, stats });
});

// GET /api/incidents/:id
router.get('/:id', requireAuth, (req, res) => {
  const incident = db.get(
    'SELECT i.*, d.device_code FROM incidents i LEFT JOIN devices d ON i.device_id = d.id WHERE i.id = ? OR i.incident_code = ?',
    [req.params.id, req.params.id]
  );
  if (!incident) return res.status(404).json({ success: false, message: 'Incident not found' });

  const events = db.all('SELECT * FROM incident_events WHERE incident_id = ? ORDER BY occurred_at ASC', [incident.id]);
  const alerts = [];

  res.json({ success: true, incident, events, alerts });
});

// PATCH /api/incidents/:id/resolve
router.patch('/:id/resolve', requireOperator, (req, res) => {
  const inc = db.get('SELECT * FROM incidents WHERE id = ? OR incident_code = ?', [req.params.id, req.params.id]);
  if (!inc) return res.status(404).json({ success: false, message: 'Not found' });

  const resolveSecs = Math.round((Date.now() - new Date(inc.detected_at).getTime()) / 1000);
  db.run(
    `UPDATE incidents SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now'), resolution_secs = ?, notes = COALESCE(?, notes) WHERE id = ?`,
    [req.user.id, resolveSecs, req.body.notes, inc.id]
  );
  db.run(
    `INSERT INTO incident_events (incident_id, event_type, description, user_id) VALUES (?, ?, ?, ?)`,
    [inc.id, 'resolved', `Resolved by ${req.user.name}: ${req.body.notes || 'No notes'}`, req.user.id]
  );

  logAudit(db, { userId: req.user.id, userName: req.user.name, action: 'incident_resolved', details: { incident_code: inc.incident_code }, ip: req.ip });
  global.io?.emit('incident:resolved', { id: inc.id, incident_code: inc.incident_code });

  res.json({ success: true });
});

// PATCH /api/incidents/:id/acknowledge
router.patch('/:id/acknowledge', requireOperator, (req, res) => {
  const inc = db.get('SELECT * FROM incidents WHERE id = ? OR incident_code = ?', [req.params.id, req.params.id]);
  if (!inc) return res.status(404).json({ success: false, message: 'Not found' });

  db.run(
    `UPDATE incidents SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = datetime('now') WHERE id = ?`,
    [req.user.id, inc.id]
  );
  db.run(
    `INSERT INTO incident_events (incident_id, event_type, description, user_id) VALUES (?, ?, ?, ?)`,
    [inc.id, 'acknowledged', `Acknowledged by ${req.user.name}`, req.user.id]
  );

  res.json({ success: true });
});

// PATCH /api/incidents/:id/escalate
router.patch('/:id/escalate', requireOperator, (req, res) => {
  const inc = db.get('SELECT * FROM incidents WHERE id = ? OR incident_code = ?', [req.params.id, req.params.id]);
  if (!inc) return res.status(404).json({ success: false, message: 'Not found' });

  db.run(`UPDATE incidents SET severity = 'critical', status = 'active' WHERE id = ?`, [inc.id]);
  db.run(
    `INSERT INTO incident_events (incident_id, event_type, description, user_id) VALUES (?, ?, ?, ?)`,
    [inc.id, 'escalated', `Escalated by ${req.user.name}`, req.user.id]
  );

  res.json({ success: true });
});

// GET /api/incidents/:id/export/csv
router.get('/:id/export/csv', requireAuth, (req, res) => {
  const inc = db.get('SELECT * FROM incidents WHERE id = ? OR incident_code = ?', [req.params.id, req.params.id]);
  if (!inc) return res.status(404).send('Not found');

  const events = db.all('SELECT * FROM incident_events WHERE incident_id = ?', [inc.id]);
  let csv = 'Field,Value\n';
  Object.entries(inc).forEach(([k, v]) => { csv += `"${k}","${v}"\n`; });
  csv += '\nTimeline Events\nTime,Type,Description\n';
  events.forEach(e => { csv += `"${e.occurred_at}","${e.event_type}","${e.description}"\n`; });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=${inc.incident_code}.csv`);
  res.send(csv);
});

// GET /api/incidents/export/all
router.get('/export/all', requireAuth, (req, res) => {
  const incidents = db.all('SELECT * FROM incidents ORDER BY detected_at DESC');
  const headers = Object.keys(incidents[0] || {});
  let csv = headers.join(',') + '\n';
  incidents.forEach(i => {
    csv += headers.map(h => `"${i[h] ?? ''}"`).join(',') + '\n';
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=all_incidents.csv');
  res.send(csv);
});

module.exports = router;
