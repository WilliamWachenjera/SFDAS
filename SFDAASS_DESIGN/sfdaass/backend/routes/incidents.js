const express = require('express');
const router = express.Router();
const { query, queryOne, queryAll } = require('../database/db');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');

// ── GET /api/incidents ───────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, severity, device_id, limit = 50, offset = 0, days = 30 } = req.query;
    let where = [`i.detected_at >= NOW() - INTERVAL '${parseInt(days)} days'`];
    const params = [];
    let pi = 1;

    if (status)    { where.push(`i.status=$${pi++}`);   params.push(status); }
    if (severity)  { where.push(`i.severity=$${pi++}`); params.push(severity); }
    if (device_id) { where.push(`i.device_id=$${pi++}`);params.push(device_id); }

    const rows = await queryAll(
      `SELECT i.*, d.device_code, d.location_label,
              EXTRACT(EPOCH FROM (COALESCE(i.resolved_at,NOW()) - i.detected_at))::INTEGER AS duration_secs
       FROM incidents i
       JOIN devices d ON d.id=i.device_id
       WHERE ${where.join(' AND ')}
       ORDER BY i.detected_at DESC
       LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`,
      params
    );

    const countRow = await queryOne(
      `SELECT COUNT(*) FROM incidents i WHERE ${where.join(' AND ')}`, params
    );

    res.json({ success: true, incidents: rows, total: parseInt(countRow.count) });
  } catch (err) {
    logger.error('Get incidents error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── GET /api/incidents/stats ─────────────────────────────────────
router.get('/stats', authenticate, async (req, res) => {
  try {
    const stats = await queryOne('SELECT * FROM v_incident_stats');
    const bySeverity = await queryAll(
      `SELECT severity, COUNT(*) AS count FROM incidents
       WHERE detected_at >= NOW() - INTERVAL '30 days' GROUP BY severity`
    );
    const byDevice = await queryAll(
      `SELECT d.device_code, d.location_label, COUNT(i.id) AS count
       FROM incidents i JOIN devices d ON d.id=i.device_id
       WHERE i.detected_at >= NOW() - INTERVAL '30 days'
       GROUP BY d.device_code, d.location_label ORDER BY count DESC LIMIT 10`
    );
    const trend = await queryAll(
      `SELECT DATE_TRUNC('day', detected_at)::DATE AS day, COUNT(*) AS count
       FROM incidents WHERE detected_at >= NOW() - INTERVAL '30 days'
       GROUP BY day ORDER BY day`
    );
    res.json({ success: true, stats, bySeverity, byDevice, trend });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── GET /api/incidents/:id ───────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const incident = await queryOne(
      `SELECT i.*, d.device_code, d.location_label, d.firmware_version,
              u.name AS resolved_by_name
       FROM incidents i
       JOIN devices d ON d.id=i.device_id
       LEFT JOIN users u ON u.id=i.resolved_by
       WHERE i.id=$1 OR i.incident_code=$1`,
      [req.params.id]
    );
    if (!incident) return res.status(404).json({ success: false, message: 'Incident not found' });

    const events = await queryAll(
      'SELECT * FROM incident_events WHERE incident_id=$1 ORDER BY occurred_at ASC',
      [incident.id]
    );

    const alerts = await queryAll(
      'SELECT channel, recipient, status, sent_at FROM alert_notifications WHERE incident_id=$1',
      [incident.id]
    );

    res.json({ success: true, incident, events, alerts });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── PATCH /api/incidents/:id/acknowledge ────────────────────────
router.patch('/:id/acknowledge', authenticate, authorize('admin', 'operator'), async (req, res) => {
  try {
    const incident = await queryOne(
      `UPDATE incidents SET status='acknowledged', updated_at=NOW()
       WHERE id=$1 AND status IN ('active', 'monitoring') RETURNING *`,
      [req.params.id]
    );
    if (!incident) return res.status(404).json({ success: false, message: 'Incident not active or not found' });
    
    await query(
      `INSERT INTO incident_events (incident_id, event_type, description, actor)
       VALUES ($1,'acknowledged','Incident acknowledged by operator',$2)`,
      [incident.id, req.user.name]
    );
    
    res.json({ success: true, incident });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── PATCH /api/incidents/:id/escalate ───────────────────────────
router.patch('/:id/escalate', authenticate, authorize('admin', 'operator'), async (req, res) => {
  try {
    const { notes } = req.body;
    const incident = await queryOne(
      `UPDATE incidents SET escalated=TRUE, escalated_at=NOW(), updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    if (!incident) return res.status(404).json({ success: false, message: 'Incident not found' });
    
    await query(
      `INSERT INTO incident_events (incident_id, event_type, description, actor)
       VALUES ($1,'escalated',$2,$3)`,
      [incident.id, `Incident escalated: ${notes || 'No notes'}`, req.user.name]
    );
    
    res.json({ success: true, incident });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── PATCH /api/incidents/:id/resolve ────────────────────────────
router.patch('/:id/resolve', authenticate, authorize('admin', 'operator'), async (req, res) => {
  try {
    const { notes } = req.body;
    const incident = await queryOne(
      `UPDATE incidents
       SET status='resolved', resolved_at=NOW(), resolved_by=$1, resolution_notes=$2,
           sprinkler_off_at=COALESCE(sprinkler_off_at, NOW())
       WHERE id=$3 AND status != 'resolved'
       RETURNING *`,
      [req.user.id, notes, req.params.id]
    );
    if (!incident) return res.status(404).json({ success: false, message: 'Incident not found or already resolved' });

    await query(
      `INSERT INTO incident_events (incident_id, event_type, description, actor)
       VALUES ($1,'resolved',$2,$3)`,
      [incident.id, `Incident resolved: ${notes || 'No notes'}`, req.user.name]
    );

    // Deactivate sprinklers
    await query(`UPDATE sprinkler_zones SET status='standby', last_deactivated=NOW() WHERE status='active'`);

    res.json({ success: true, incident });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── PATCH /api/incidents/:id/false-alarm ────────────────────────
router.patch('/:id/false-alarm', authenticate, authorize('admin', 'operator'), async (req, res) => {
  try {
    const incident = await queryOne(
      `UPDATE incidents SET status='false_alarm', resolved_at=NOW(), resolved_by=$1
       WHERE id=$2 RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (!incident) return res.status(404).json({ success: false, message: 'Incident not found' });
    res.json({ success: true, incident });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── GET /api/incidents/:id/export/csv ────────────────────────────
router.get('/:id/export/csv', authenticate, async (req, res) => {
  try {
    const incident = await queryOne(
      `SELECT i.*, d.device_code, d.location_label FROM incidents i
       JOIN devices d ON d.id=i.device_id WHERE i.id=$1 OR i.incident_code=$1`,
      [req.params.id]
    );
    if (!incident) return res.status(404).json({ success: false, message: 'Not found' });

    const events = await queryAll(
      'SELECT occurred_at, event_type, description, actor FROM incident_events WHERE incident_id=$1 ORDER BY occurred_at',
      [incident.id]
    );

    const rows = [
      ['Field', 'Value'],
      ['Incident ID', incident.incident_code],
      ['Date & Time', incident.detected_at],
      ['Device', incident.device_code],
      ['Location', incident.location_label],
      ['Severity', incident.severity],
      ['Status', incident.status],
      ['GPS Lat', incident.gps_lat],
      ['GPS Lng', incident.gps_lng],
      ['Inside Geofence', incident.inside_geofence],
      ['Smoke (ppm)', incident.smoke_ppm],
      ['Temperature (°C)', incident.temperature_c],
      ['Gas (ppm)', incident.gas_ppm],
      ['Flame Detected', incident.flame_detected],
      ['Sprinkler Activated', incident.sprinkler_activated],
      ['Sprinkler On At', incident.sprinkler_on_at],
      ['Sprinkler Off At', incident.sprinkler_off_at],
      ['Resolved At', incident.resolved_at],
      ['Resolution Notes', incident.resolution_notes],
      [],
      ['--- TIMELINE ---'],
      ['Time', 'Event', 'Description', 'Actor'],
      ...events.map(e => [e.occurred_at, e.event_type, e.description, e.actor]),
    ];

    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="incident_${incident.incident_code}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── GET /api/incidents/export/all ────────────────────────────────
router.get('/export/all', authenticate, async (req, res) => {
  try {
    const incidents = await queryAll(
      `SELECT i.incident_code, i.detected_at, i.resolved_at, i.severity, i.status,
              d.device_code, d.location_label,
              i.smoke_ppm, i.temperature_c, i.gas_ppm, i.flame_detected,
              i.gps_lat, i.gps_lng, i.inside_geofence,
              i.sprinkler_activated, i.resolution_notes
       FROM incidents i JOIN devices d ON d.id=i.device_id
       ORDER BY i.detected_at DESC`
    );

    const headers = ['Incident Code','Detected At','Resolved At','Severity','Status',
      'Device','Location','Smoke (ppm)','Temp (°C)','Gas (ppm)','Flame',
      'GPS Lat','GPS Lng','Inside Geofence','Sprinkler Activated','Notes'];

    const csv = [
      headers.map(h => `"${h}"`).join(','),
      ...incidents.map(i => [
        i.incident_code, i.detected_at, i.resolved_at, i.severity, i.status,
        i.device_code, i.location_label, i.smoke_ppm, i.temperature_c, i.gas_ppm,
        i.flame_detected, i.gps_lat, i.gps_lng, i.inside_geofence,
        i.sprinkler_activated, i.resolution_notes
      ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="all_incidents.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
