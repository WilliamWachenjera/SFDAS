// routes/geofence.js — PostGIS edition
const router = require('express').Router();
const db = require('../db/database');
const { requireAuth, requireOperator } = require('../middleware/auth');

// GET /api/geofence/active
router.get('/active', requireAuth, async (req, res) => {
  try {
    const geofence = await db.get(
      `SELECT id, name, type, center_lat, center_lng, radius_meters, 
              polygon_coords, is_active, created_at, ST_AsGeoJSON(geom) AS geom_geojson
       FROM geofences WHERE is_active = 1 ORDER BY id DESC LIMIT 1`
    );
    
    if (geofence && geofence.polygon_coords) {
      try { geofence.polygon_coords = JSON.parse(geofence.polygon_coords); } catch (e) {}
    }
    
    res.json({ success: true, geofence: geofence || null });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/geofence
router.get('/', requireAuth, async (req, res) => {
  try {
    const geofences = await db.all(
      `SELECT id, name, type, center_lat, center_lng, radius_meters, 
              is_active, created_at, ST_AsGeoJSON(geom) AS geom_geojson
       FROM geofences ORDER BY id DESC`
    );
    res.json({ success: true, geofences });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/geofence
router.post('/', requireOperator, async (req, res) => {
  try {
    const { name, type = 'circle', center_lat, center_lng, radius_meters = 500, polygon_coords } = req.body;

    await db.query('UPDATE geofences SET is_active = 0');

    const polyJson = polygon_coords ? JSON.stringify(polygon_coords) : null;
    let result;

    if (type === 'circle') {
      result = await db.query(
        `INSERT INTO geofences (name, type, center_lat, center_lng, radius_meters, polygon_coords, geom, is_active)
         VALUES ($1, $2, $3, $4, $5, $6,
           ST_Buffer(ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, $5)::geometry, 1)
         RETURNING id`,
        [name || 'Facility', type, center_lat, center_lng, radius_meters, polyJson]
      );
    } else if (type === 'polygon' && Array.isArray(polygon_coords) && polygon_coords.length >= 3) {
      const closed = polygon_coords.concat([polygon_coords[0]]);
      const wktPoints = closed.map(p => `${p.lng} ${p.lat}`).join(', ');

      result = await db.query(
        `INSERT INTO geofences (name, type, center_lat, center_lng, radius_meters, polygon_coords, geom, is_active)
         VALUES ($1, $2, $3, $4, $5, $6,
           ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(${wktPoints})')), 4326), 1)
         RETURNING id`,
        [name || 'Facility', type, center_lat, center_lng, radius_meters, polyJson]
      );
    } else {
      return res.status(400).json({ success: false, message: 'Invalid geofence type or coordinates' });
    }

    const newId = result.rows[0].id;
    const geofence = await db.get(
      'SELECT *, ST_AsGeoJSON(geom) AS geom_geojson FROM geofences WHERE id = $1',
      [newId]
    );

    if (geofence && geofence.polygon_coords) {
      try { geofence.polygon_coords = JSON.parse(geofence.polygon_coords); } catch (e) {}
    }

    if (global.io) global.io.emit('geofence:updated', {});
    res.json({ success: true, geofence });

  } catch (e) {
    console.error('Geofence save error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// PATCH /api/geofence/:id
router.patch('/:id', requireOperator, async (req, res) => {
  try {
    const { name, radius_meters, status } = req.body;
    const is_active = status === 'active' ? 1 : status === 'inactive' ? 0 : null;

    await db.query(
      `UPDATE geofences SET
        name = COALESCE($1, name),
        radius_meters = COALESCE($2, radius_meters),
        is_active = COALESCE($3, is_active),
        geom = CASE WHEN $2 IS NOT NULL AND type = 'circle'
               THEN ST_Buffer(ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326)::geography, $2)::geometry
               ELSE geom END
       WHERE id = $4`,
      [name, radius_meters, is_active, req.params.id]
    );

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/geofence/:id/devices
router.get('/:id/devices', requireAuth, async (req, res) => {
  try {
    const devices = await db.all(
      `SELECT d.device_code, d.name, d.location_label, d.status, d.gps_lat, d.gps_lng,
              ROUND(ST_Distance(d.location::geography, ST_Centroid(g.geom)::geography)) AS distance_m
       FROM devices d, geofences g
       WHERE g.id = $1 AND d.location IS NOT NULL AND ST_Within(d.location, g.geom)
       ORDER BY distance_m ASC`,
      [req.params.id]
    );
    res.json({ success: true, devices, count: devices.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;