// routes/incidents.js
const router = require('express').Router();
const db = require('../db/database');
const { requireAuth, requireOperator, logAudit } = require('../middleware/auth');

// GET /api/incidents
router.get('/', requireAuth, async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const days = parseInt(req.query.days) || 90;
  const status = req.query.status;
  const severity = req.query.severity;

  try {
    let sql = `
      SELECT i.*, d.device_code as dc
      FROM incidents i
      LEFT JOIN devices d ON i.device_id = d.id
      WHERE i.detected_at >= NOW() - INTERVAL '${days} days'
    `;
    let params = [];

    if (status) {
      sql += ` AND i.status = $${params.length + 1}`;
      params.push(status);
    }
    if (severity) {
      sql += ` AND i.severity = $${params.length + 1}`;
      params.push(severity);
    }
    sql += ` ORDER BY i.detected_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const incidents = await db.all(sql, params);
    res.json({ success: true, incidents });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/incidents/stats
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const totalRes = await db.get('SELECT COUNT(*) as n FROM incidents');
    const activeRes = await db.get(`SELECT COUNT(*) as n FROM incidents WHERE status IN ('active','monitoring','acknowledged')`);
    const resolvedRes = await db.get(`SELECT COUNT(*) as n FROM incidents WHERE status = 'resolved'`);
    const monthRes = await db.get(`SELECT COUNT(*) as n FROM incidents WHERE TO_CHAR(detected_at, 'YYYY-MM') = TO_CHAR(NOW(), 'YYYY-MM')`);
    const avgRes = await db.get('SELECT AVG(resolution_secs) as n FROM incidents WHERE resolution_secs IS NOT NULL');
    const bySevRes = await db.all('SELECT severity, COUNT(*) as count FROM incidents GROUP BY severity');

    const stats = {
      total: parseInt(totalRes?.n || 0),
      active_count: parseInt(activeRes?.n || 0),
      resolved_count: parseInt(resolvedRes?.n || 0),
      this_month: parseInt(monthRes?.n || 0),
      avg_resolution_secs: parseFloat(avgRes?.n || 0),
      by_severity: bySevRes,
    };
    res.json({ success: true, stats });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/incidents/export/all
router.get('/export/all', requireAuth, async (req, res) => {
  try {
    const incidents = await db.all(`
      SELECT i.incident_code, i.detected_at, d.device_code, i.location_label, i.severity,
             i.smoke_ppm, i.temperature_c, i.gas_ppm, i.humidity_pct,
             i.gps_lat, i.gps_lng, i.inside_geofence, i.sprinkler_activated,
             i.status, i.resolved_at, i.resolution_secs, i.notes
      FROM incidents i LEFT JOIN devices d ON i.device_id = d.id
      ORDER BY i.detected_at DESC
    `);

    if (!incidents || incidents.length === 0) {
      const emptyCSV = 'Incident Code,Date & Time,Device,Location,Severity,Smoke (ppm),Temperature (°C),Gas (ppm),Humidity (%),GPS Lat,GPS Lng,Inside Geofence,Sprinkler Activated,Status,Resolved At,Resolution (secs),Notes\n';
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="sfdaass_incidents_empty.csv"');
      return res.send(emptyCSV);
    }

    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

    const headers = ['Incident Code','Date & Time','Device','Location','Severity','Smoke (ppm)','Temperature (°C)','Gas (ppm)','Humidity (%)','GPS Lat','GPS Lng','Inside Geofence','Sprinkler Activated','Status','Resolved At','Resolution (secs)','Notes'];

    const rows = incidents.map(i => [
      esc(i.incident_code), esc(i.detected_at), esc(i.device_code), esc(i.location_label), esc(i.severity),
      esc(i.smoke_ppm), esc(i.temperature_c), esc(i.gas_ppm), esc(i.humidity_pct),
      esc(i.gps_lat), esc(i.gps_lng), esc(i.inside_geofence ? 'Yes' : 'No'),
      esc(i.sprinkler_activated ? 'Yes' : 'No'), esc(i.status), esc(i.resolved_at),
      esc(i.resolution_secs), esc(i.notes)
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    const filename = `sfdaass_incidents_${new Date().toISOString().slice(0,10)}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Export failed' });
  }
});

// GET /api/incidents/:id/export/csv
router.get('/:id/export/csv', requireAuth, async (req, res) => {
  try {
    const idNum = parseInt(req.params.id);
    let inc;
    if (!isNaN(idNum) && String(idNum) === req.params.id) {
      inc = await db.get(`
        SELECT i.*, d.device_code FROM incidents i 
        LEFT JOIN devices d ON i.device_id = d.id 
        WHERE i.id = $1 OR i.incident_code = $2
      `, [idNum, req.params.id]);
    } else {
      inc = await db.get(`
        SELECT i.*, d.device_code FROM incidents i 
        LEFT JOIN devices d ON i.device_id = d.id 
        WHERE i.incident_code = $1
      `, [req.params.id]);
    }

    if (!inc) return res.status(404).json({ success: false, message: 'Incident not found' });

    const events = await db.all(
      'SELECT event_type, description, occurred_at FROM incident_events WHERE incident_id = $1 ORDER BY occurred_at ASC',
      [inc.id]
    );

    // CSV generation logic
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [
      ['Field', 'Value'],
      ['Incident ID', inc.incident_code],
      ['Date & Time', inc.detected_at],
      ['Device', inc.device_code],
      ['Location', inc.location_label],
      ['Severity', inc.severity],
      ['Status', inc.status],
      ['GPS Lat', inc.gps_lat],
      ['GPS Lng', inc.gps_lng],
      ['Inside Geofence', inc.inside_geofence],
      ['Smoke (ppm)', inc.smoke_ppm],
      ['Temperature (°C)', inc.temperature_c],
      ['Gas (ppm)', inc.gas_ppm],
      ['Flame Detected', inc.flame_detected],
      ['Sprinkler Activated', inc.sprinkler_activated],
      ['Sprinkler On At', inc.sprinkler_on_at],
      ['Sprinkler Off At', inc.sprinkler_off_at],
      ['Resolved At', inc.resolved_at],
      ['Resolution Notes', inc.resolution_notes],
      [],
      ['--- TIMELINE ---'],
      ['Time', 'Event', 'Description', 'Actor'],
      ...events.map(e => [e.occurred_at, e.event_type, e.description, e.actor]),
    ];

    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="incident_${inc.incident_code}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Export failed' });
  }
});

// GET /api/incidents/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const idNum = parseInt(req.params.id);
    let incident;
    if (!isNaN(idNum) && String(idNum) === req.params.id) {
      incident = await db.get(
        'SELECT i.*, d.device_code FROM incidents i LEFT JOIN devices d ON i.device_id = d.id WHERE i.id = $1 OR i.incident_code = $2',
        [idNum, req.params.id]
      );
    } else {
      incident = await db.get(
        'SELECT i.*, d.device_code FROM incidents i LEFT JOIN devices d ON i.device_id = d.id WHERE i.incident_code = $1',
        [req.params.id]
      );
    }

    if (!incident) return res.status(404).json({ success: false, message: 'Incident not found' });

    const events = await db.all('SELECT * FROM incident_events WHERE incident_id = $1 ORDER BY occurred_at ASC', [incident.id]);
    res.json({ success: true, incident, events });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// PATCH /api/incidents/:id/acknowledge
router.patch('/:id/acknowledge', requireOperator, async (req, res) => {
  try {
    const { notes } = req.body || {};
    const idNum = parseInt(req.params.id);
    const incident = !isNaN(idNum) && String(idNum) === req.params.id
      ? await db.get('SELECT * FROM incidents WHERE id = $1', [idNum])
      : await db.get('SELECT * FROM incidents WHERE incident_code = $1', [req.params.id]);
    if (!incident) return res.status(404).json({ success: false, message: 'Incident not found' });
    if (incident.status === 'resolved') return res.status(400).json({ success: false, message: 'Incident is already resolved' });

    await db.query(
      'UPDATE incidents SET status = $1 WHERE id = $2',
      ['acknowledged', incident.id]
    );
    await db.query(
      'INSERT INTO incident_events (incident_id, event_type, description) VALUES ($1, $2, $3)',
      [incident.id, 'acknowledged', notes || 'Acknowledged via dashboard']
    );

    const io = req.app.get('io');
    if (io) io.emit('incident:acknowledged', { id: incident.id, incident_code: incident.incident_code });

    await logAudit(req, 'incident_acknowledged', `Incident ${incident.incident_code} acknowledged`);
    res.json({ success: true, message: 'Incident acknowledged' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// PATCH /api/incidents/:id/resolve
router.patch('/:id/resolve', requireOperator, async (req, res) => {
  try {
    const { notes } = req.body || {};
    const idNum = parseInt(req.params.id);
    const incident = !isNaN(idNum) && String(idNum) === req.params.id
      ? await db.get('SELECT * FROM incidents WHERE id = $1', [idNum])
      : await db.get('SELECT * FROM incidents WHERE incident_code = $1', [req.params.id]);
    if (!incident) return res.status(404).json({ success: false, message: 'Incident not found' });
    if (incident.status === 'resolved') return res.status(400).json({ success: false, message: 'Incident is already resolved' });

    const resolvedAt = new Date();
    const detectedAt = new Date(incident.detected_at);
    const resolutionSecs = Math.round((resolvedAt - detectedAt) / 1000);

    await db.query(
      'UPDATE incidents SET status = $1, resolved_at = $2, resolution_secs = $3 WHERE id = $4',
      ['resolved', resolvedAt.toISOString(), resolutionSecs, incident.id]
    );
    await db.query(
      'INSERT INTO incident_events (incident_id, event_type, description) VALUES ($1, $2, $3)',
      [incident.id, 'resolved', notes || 'Resolved via dashboard']
    );

    const io = req.app.get('io');
    if (io) io.emit('incident:resolved', { id: incident.id, incident_code: incident.incident_code });

    await logAudit(req, 'incident_resolved', `Incident ${incident.incident_code} resolved`);
    res.json({ success: true, message: 'Incident resolved', resolution_secs: resolutionSecs });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// PATCH /api/incidents/:id/escalate
router.patch('/:id/escalate', requireOperator, async (req, res) => {
  try {
    const { notes } = req.body || {};
    const idNum = parseInt(req.params.id);
    const incident = !isNaN(idNum) && String(idNum) === req.params.id
      ? await db.get('SELECT * FROM incidents WHERE id = $1', [idNum])
      : await db.get('SELECT * FROM incidents WHERE incident_code = $1', [req.params.id]);
    if (!incident) return res.status(404).json({ success: false, message: 'Incident not found' });
    if (incident.status === 'resolved') return res.status(400).json({ success: false, message: 'Cannot escalate a resolved incident' });

    await db.query(
      'UPDATE incidents SET severity = $1, status = $2 WHERE id = $3',
      ['critical', 'active', incident.id]
    );
    await db.query(
      'INSERT INTO incident_events (incident_id, event_type, description) VALUES ($1, $2, $3)',
      [incident.id, 'escalated', notes || 'Escalated to critical via dashboard']
    );

    const io = req.app.get('io');
    if (io) io.emit('incident:escalated', { id: incident.id, incident_code: incident.incident_code });

    await logAudit(req, 'incident_escalated', `Incident ${incident.incident_code} escalated to critical`);
    res.json({ success: true, message: 'Incident escalated to critical' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;