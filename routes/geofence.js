// routes/geofence.js

const router = require('express').Router();
const db = require('../db/database');
const { requireAuth, requireOperator } = require('../middleware/auth');

// GET /api/geofence/active
router.get('/active', requireAuth, (req, res) => {
  const geofence = db.get('SELECT * FROM geofences WHERE is_active = 1 ORDER BY id DESC LIMIT 1');
  if (geofence && geofence.polygon_coords) {
    try { geofence.polygon_coords = JSON.parse(geofence.polygon_coords); } catch (e) {}
  }
  res.json({ success: true, geofence: geofence || null });
});

// GET /api/geofence
router.get('/', requireAuth, (req, res) => {
  const geofences = db.all('SELECT * FROM geofences ORDER BY id DESC');
  res.json({ success: true, geofences });
});

// POST /api/geofence — Save/update geofence
router.post('/', requireOperator, (req, res) => {
  const { name, type, center_lat, center_lng, radius_meters, polygon_coords } = req.body;

  // Deactivate all existing
  db.run('UPDATE geofences SET is_active = 0');

  const polyJson = polygon_coords ? JSON.stringify(polygon_coords) : null;
  const result = db.run(
    'INSERT INTO geofences (name, type, center_lat, center_lng, radius_meters, polygon_coords, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)',
    [name || 'Facility', type || 'circle', center_lat, center_lng, radius_meters || 500, polyJson]
  );

  global.io?.emit('geofence:updated', {});

  const geofence = db.get('SELECT * FROM geofences WHERE id = ?', [result.lastID]);
  if (geofence.polygon_coords) {
    try { geofence.polygon_coords = JSON.parse(geofence.polygon_coords); } catch (e) {}
  }
  res.json({ success: true, geofence });
});

// PATCH /api/geofence/:id
router.patch('/:id', requireOperator, (req, res) => {
  const { name, radius_meters, status } = req.body;
  db.run(
    'UPDATE geofences SET name = COALESCE(?, name), radius_meters = COALESCE(?, radius_meters), is_active = COALESCE(?, is_active) WHERE id = ?',
    [name, radius_meters, status === 'active' ? 1 : status === 'inactive' ? 0 : undefined, req.params.id]
  );
  res.json({ success: true });
});

module.exports = router;
