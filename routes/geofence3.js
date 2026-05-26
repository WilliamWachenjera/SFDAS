// routes/geofence.js — PostGIS edition
// Saves geofences as PostGIS geometry objects.
// ST_Within used for spatial device queries.

var router = require('express').Router();
var db     = require('../db/database');
var auth   = require('../middleware/auth');
var requireAuth     = auth.requireAuth;
var requireOperator = auth.requireOperator;

// GET /api/geofence/active
router.get('/active', requireAuth, async function(req, res) {
  try {
    var geofence = await db.get(
      [
        'SELECT id, name, type, center_lat, center_lng,',
        '  radius_meters, polygon_coords, is_active, created_at,',
        '  ST_AsGeoJSON(geom) AS geom_geojson',
        'FROM geofences',
        'WHERE is_active = 1',
        'ORDER BY id DESC',
        'LIMIT 1'
      ].join(' ')
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
router.get('/', requireAuth, async function(req, res) {
  try {
    var geofences = await db.all(
      [
        'SELECT id, name, type, center_lat, center_lng,',
        '  radius_meters, is_active, created_at,',
        '  ST_AsGeoJSON(geom) AS geom_geojson',
        'FROM geofences ORDER BY id DESC'
      ].join(' ')
    );
    res.json({ success: true, geofences: geofences });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/geofence — create or replace active geofence
router.post('/', requireOperator, async function(req, res) {
  try {
    var name           = req.body.name;
    var type           = req.body.type || 'circle';
    var center_lat     = req.body.center_lat;
    var center_lng     = req.body.center_lng;
    var radius_meters  = req.body.radius_meters || 500;
    var polygon_coords = req.body.polygon_coords;

    // Deactivate all existing geofences
    await db.query('UPDATE geofences SET is_active = 0');

    var polyJson = polygon_coords ? JSON.stringify(polygon_coords) : null;
    var result;

    if (type === 'circle') {
      // ST_Buffer on geography creates a true-metre circular boundary.
      // ::geography cast makes the buffer use metres not degrees.
      // ::geometry cast back for storage in the geom column.
      result = await db.query(
        [
          'INSERT INTO geofences',
          '  (name, type, center_lat, center_lng, radius_meters, polygon_coords, geom, is_active)',
          'VALUES ($1, $2, $3, $4, $5, $6,',
          '  ST_Buffer(',
          '    ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography,',
          '    $5',
          '  )::geometry,',
          '  1)',
          'RETURNING id'
        ].join(' '),
        [name || 'Facility', type, center_lat, center_lng, radius_meters, polyJson]
      );

    } else if (type === 'polygon' && Array.isArray(polygon_coords) && polygon_coords.length >= 3) {
      // Close the ring by repeating the first point at the end
      var closed = polygon_coords.concat([polygon_coords[0]]);
      // Build WKT LINESTRING from the points — PostGIS lng lat order
      var wktPoints = closed.map(function(p) {
        return p.lng + ' ' + p.lat;
      }).join(', ');

      result = await db.query(
        [
          'INSERT INTO geofences',
          '  (name, type, center_lat, center_lng, radius_meters, polygon_coords, geom, is_active)',
          'VALUES ($1, $2, $3, $4, $5, $6,',
          '  ST_SetSRID(',
          "    ST_MakePolygon(ST_GeomFromText('LINESTRING(" + wktPoints + ")')),",
          '    4326',
          '  ),',
          '  1)',
          'RETURNING id'
        ].join(' '),
        [name || 'Facility', type, center_lat, center_lng, radius_meters, polyJson]
      );

    } else {
      return res.status(400).json({ success: false, message: 'Invalid geofence type or coordinates' });
    }

    var newId    = result.rows[0].id;
    var geofence = await db.get(
      'SELECT *, ST_AsGeoJSON(geom) AS geom_geojson FROM geofences WHERE id = $1',
      [newId]
    );
    if (geofence && geofence.polygon_coords) {
      try { geofence.polygon_coords = JSON.parse(geofence.polygon_coords); } catch (e) {}
    }

    if (global.io) global.io.emit('geofence:updated', {});
    res.json({ success: true, geofence: geofence });

  } catch (e) {
    console.error('Geofence save error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// PATCH /api/geofence/:id
router.patch('/:id', requireOperator, async function(req, res) {
  try {
    var name          = req.body.name          || null;
    var radius_meters = req.body.radius_meters || null;
    var status        = req.body.status;
    var is_active     = status === 'active' ? 1 : status === 'inactive' ? 0 : null;

    await db.query(
      [
        'UPDATE geofences SET',
        '  name          = COALESCE($1, name),',
        '  radius_meters = COALESCE($2, radius_meters),',
        '  is_active     = COALESCE($3, is_active),',
        '  geom = CASE',
        '    WHEN $2 IS NOT NULL AND type = $4',
        '    THEN ST_Buffer(',
        '      ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326)::geography,',
        '      $2',
        '    )::geometry',
        '    ELSE geom',
        '  END',
        'WHERE id = $5'
      ].join(' '),
      [name, radius_meters, is_active, 'circle', req.params.id]
    );

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/geofence/:id/devices
// Returns all devices currently inside this geofence using ST_Within
router.get('/:id/devices', requireAuth, async function(req, res) {
  try {
    var devices = await db.all(
      [
        'SELECT d.device_code, d.name, d.location_label,',
        '  d.status, d.gps_lat, d.gps_lng,',
        '  ROUND(ST_Distance(',
        '    d.location::geography,',
        '    ST_Centroid(g.geom)::geography',
        '  )) AS distance_m',
        'FROM devices d, geofences g',
        'WHERE g.id = $1',
        '  AND d.location IS NOT NULL',
        '  AND ST_Within(d.location, g.geom)',
        'ORDER BY distance_m ASC'
      ].join(' '),
      [req.params.id]
    );
    res.json({ success: true, devices: devices, count: devices.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
