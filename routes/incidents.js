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

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT ROUTES — must be defined BEFORE /:id to avoid Express treating
// the word "export" as an incident ID parameter
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/incidents/export/all
router.get('/export/all', requireAuth, (req, res) => {
  try {
    const incidents = db.all(`
      SELECT
        i.incident_code,
        i.detected_at,
        d.device_code,
        i.location_label,
        i.severity,
        i.smoke_ppm,
        i.temperature_c,
        i.gas_ppm,
        i.humidity_pct,
        i.gps_lat,
        i.gps_lng,
        i.inside_geofence,
        i.sprinkler_activated,
        i.status,
        i.resolved_at,
        i.resolution_secs,
        i.notes
      FROM incidents i
      LEFT JOIN devices d ON i.device_id = d.id
      ORDER BY i.detected_at DESC
    `);

    if (!incidents || incidents.length === 0) {
      // Return an empty CSV with just headers rather than an error,
      // so the browser still triggers a download
      const emptyCSV =
        'Incident Code,Date & Time,Device,Location,Severity,' +
        'Smoke (ppm),Temperature (°C),Gas (ppm),Humidity (%),' +
        'GPS Lat,GPS Lng,Inside Geofence,Sprinkler Activated,' +
        'Status,Resolved At,Resolution (secs),Notes\n';

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="sfdaass_incidents_empty.csv"');
      return res.send(emptyCSV);
    }

    // Helper: escape a value for CSV (wraps in quotes, escapes internal quotes)
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

    const headers = [
      'Incident Code', 'Date & Time', 'Device', 'Location', 'Severity',
      'Smoke (ppm)', 'Temperature (°C)', 'Gas (ppm)', 'Humidity (%)',
      'GPS Lat', 'GPS Lng', 'Inside Geofence', 'Sprinkler Activated',
      'Status', 'Resolved At', 'Resolution (secs)', 'Notes'
    ];

    const rows = incidents.map(i => [
      esc(i.incident_code),
      esc(i.detected_at),
      esc(i.device_code),
      esc(i.location_label),
      esc(i.severity),
      esc(i.smoke_ppm),
      esc(i.temperature_c),
      esc(i.gas_ppm),
      esc(i.humidity_pct),
      esc(i.gps_lat),
      esc(i.gps_lng),
      esc(i.inside_geofence ? 'Yes' : 'No'),
      esc(i.sprinkler_activated ? 'Yes' : 'No'),
      esc(i.status),
      esc(i.resolved_at),
      esc(i.resolution_secs),
      esc(i.notes),
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    const filename = `sfdaass_incidents_${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);

  } catch (err) {
    console.error('Export all CSV error:', err);
    res.status(500).json({ success: false, message: 'Export failed' });
  }
});

// GET /api/incidents/:id/export/csv
router.get('/:id/export/csv', requireAuth, (req, res) => {
  try {
    const inc = db.get(`
      SELECT
        i.*,
        d.device_code
      FROM incidents i
      LEFT JOIN devices d ON i.device_id = d.id
      WHERE i.id = ? OR i.incident_code = ?
    `, [req.params.id, req.params.id]);

    if (!inc) return res.status(404).json({ success: false, message: 'Incident not found' });

    const events = db.all(
      'SELECT event_type, description, occurred_at FROM incident_events WHERE incident_id = ? ORDER BY occurred_at ASC',
      [inc.id]
    );

    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

    // ── Section 1: Incident summary ──────────────────────
    const summaryHeaders = [
      'Incident Code', 'Date & Time', 'Device', 'Location', 'Severity',
      'Smoke (ppm)', 'Temperature (°C)', 'Gas (ppm)', 'Humidity (%)',
      'GPS Lat', 'GPS Lng', 'Inside Geofence', 'Sprinkler Activated',
      'Status', 'Resolved At', 'Resolution (secs)', 'Notes'
    ];

    const summaryRow = [
      esc(inc.incident_code),
      esc(inc.detected_at),
      esc(inc.device_code),
      esc(inc.location_label),
      esc(inc.severity),
      esc(inc.smoke_ppm),
      esc(inc.temperature_c),
      esc(inc.gas_ppm),
      esc(inc.humidity_pct),
      esc(inc.gps_lat),
      esc(inc.gps_lng),
      esc(inc.inside_geofence ? 'Yes' : 'No'),
      esc(inc.sprinkler_activated ? 'Yes' : 'No'),
      esc(inc.status),
      esc(inc.resolved_at),
      esc(inc.resolution_secs),
      esc(inc.notes),
    ].join(',');

    // ── Section 2: Timeline events ───────────────────────
    const eventLines = events.length > 0
      ? [
          '\nTIMELINE EVENTS',
          'Time,Event Type,Description',
          ...events.map(e => [esc(e.occurred_at), esc(e.event_type), esc(e.description)].join(','))
        ].join('\n')
      : '\nTIMELINE EVENTS\nNo events recorded.';

    const csv = [summaryHeaders.join(','), summaryRow, eventLines].join('\n');
    const filename = `${inc.incident_code}_${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);

  } catch (err) {
    console.error('Export single CSV error:', err);
    res.status(500).json({ success: false, message: 'Export failed' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PARAM ROUTES — kept below all static-path routes
// ─────────────────────────────────────────────────────────────────────────────

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

  if (req.user.role === 'operator') {
    const user = db.get('SELECT assigned_devices FROM users WHERE id = ?', [req.user.id]);
    const assigned = JSON.parse(user.assigned_devices || '[]');
    if (!inc.device_code || !assigned.includes(inc.device_code)) {
      return res.status(403).json({ success: false, message: "Access denied: You are not assigned to this device's incidents." });
    }
  }

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

  if (req.user.role === 'operator') {
    const user = db.get('SELECT assigned_devices FROM users WHERE id = ?', [req.user.id]);
    const assigned = JSON.parse(user.assigned_devices || '[]');
    if (!inc.device_code || !assigned.includes(inc.device_code)) {
      return res.status(403).json({ success: false, message: "Access denied: You are not assigned to this device's incidents." });
    }
  }

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

  if (req.user.role === 'operator') {
    const user = db.get('SELECT assigned_devices FROM users WHERE id = ?', [req.user.id]);
    const assigned = JSON.parse(user.assigned_devices || '[]');
    if (!inc.device_code || !assigned.includes(inc.device_code)) {
      return res.status(403).json({ success: false, message: "Access denied: You are not assigned to this device's incidents." });
    }
  }

  db.run(`UPDATE incidents SET severity = 'critical', status = 'active' WHERE id = ?`, [inc.id]);
  db.run(
    `INSERT INTO incident_events (incident_id, event_type, description, user_id) VALUES (?, ?, ?, ?)`,
    [inc.id, 'escalated', `Escalated by ${req.user.name}`, req.user.id]
  );

  res.json({ success: true });
});

module.exports = router;