// routes/geofence.js — PostGIS Edition
// Key changes:
//   - Saving a geofence now stores a PostGIS geometry (geom column)
//   - Circle geofences use ST_Buffer on a geography object (true metres)
//   - Polygon geofences use ST_MakePolygon / ST_GeomFromText
//   - GET active returns the geofence with GeoJSON for the map

const router  = require('express').Router();
const db      = require('../db/database');
const { requireAuth, requireOperator } = require('../middleware/auth');

// ── GET /api/geofence/active ──────────────────────────────────
router.get('/active', requireAuth, async (req, res) => {
  try {
    // ST_AsGeoJSON converts the PostGIS geometry to GeoJSON so the
    // Leaflet map in the frontend can draw it directly.
    const geofence = await db.get(
      `SELECT id, name, type, center_lat, center_lng, radius_meters,
              polygon_coords, is_active, created_at,
              ST_AsGeoJSON(geom) AS geom_geojson
       FROM geofences
       WHERE is_active = 1
       ORDER BY id DESC
       LIMIT 1`
    );
    if (geofence?.polygon_coords) {
      try { geofence.polygon_coords = JSON.parse(geofence.polygon_coords); } catch (_) {}
    }
    res.json({ success: true, geofence: geofence || null });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /api/geofence ─────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const geofences = await db.all(
      `SELECT id, name, type, center_lat, center_lng,
              radius_meters, is_active, created_at,
              ST_AsGeoJSON(geom) AS geom_geojson
       FROM geofences ORDER BY id DESC`
    );
    res.json({ success: true, geofences });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── POST /api/geofence — create / replace ─────────────────────
router.post('/', requireOperator, async (req, res) => {
  try {
    const { name, type, center_lat, center_lng, radius_meters, polygon_coords } = req.body;

    // Deactivate existing geofences
    await db.query('UPDATE geofences SET is_active = 0');

    let geomSql;
    let geomParams;

    if (type === 'circle' || !type) {
      // Circle: use ST_Buffer on a geography point for true-metre radius.
      // Cast back to geometry for storage (geography can't be indexed as GIST easily).
      // ST_MakePoint(longitude, latitude) — PostGIS uses lng,lat order.
      geomSql = `ST_Buffer(
                   ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                   $3
                 )::geometry`;
      geomParams = [center_lng, center_lat, radius_meters || 500];
    } else if (type === 'polygon' && Array.isArray(polygon_coords) && polygon_coords.length >= 3) {
      // Polygon: build from the array of {lat, lng} points coming from the map.
      // ST_MakePolygon requires a closed ring, so we add the first point at the end.
      const closed = [...polygon_coords, polygon_coords[0]];
      const wkt = closed.map(p => `${p.lng} ${p.lat}`).join(', ');
      geomSql = `ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(${wkt})')), 4326)`;
      geomParams = [];
    } else {
      return res.status(400).json({ success: false, message: 'Invalid geofence type or missing coordinates' });
    }

    const polyJson = polygon_coords ? JSON.stringify(polygon_coords) : null;

    // Build the INSERT with the correct param count
    const baseParams = [name || 'Facility', type || 'circle', center_lat, center_lng,
                        radius_meters || 500, polyJson, ...geomParams];
    const geomIdx    = baseParams.length - geomParams.length + 1;

    const result = await db.query(
      `INSERT INTO geofences
         (name, type, center_lat, center_lng, radius_meters, polygon_coords, geom, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, ${geomSql.replace(/\$(\d+)/g, (_, n) => `$${parseInt(n) + 6}`)}, 1)
       RETURNING id`,
      baseParams
    );

    // Re-fetch with GeoJSON for the response
    const geofence = await db.get(
      `SELECT *, ST_AsGeoJSON(geom) AS geom_geojson FROM geofences WHERE id = $1`,
      [result.rows[0].id]
    );
    if (geofence?.polygon_coords) {
      try { geofence.polygon_coords = JSON.parse(geofence.polygon_coords); } catch (_) {}
    }

    global.io?.emit('geofence:updated', {});
    res.json({ success: true, geofence });
  } catch (e) {
    console.error('Geofence save error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── PATCH /api/geofence/:id ───────────────────────────────────
router.patch('/:id', requireOperator, async (req, res) => {
  try {
    const { name, radius_meters, status } = req.body;
    await db.query(
      `UPDATE geofences
       SET name = COALESCE($1, name),
           radius_meters = COALESCE($2, radius_meters),
           is_active = COALESCE($3, is_active),
           geom = CASE
                    WHEN $2 IS NOT NULL AND type = 'circle'
                    THEN ST_Buffer(
                           ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326)::geography,
                           $2
                         )::geometry
                    ELSE geom
                  END
       WHERE id = $4`,
      [name ?? null, radius_meters ?? null,
       status === 'active' ? 1 : status === 'inactive' ? 0 : null,
       req.params.id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /api/geofence/:id/devices — devices inside this fence ─
// Uses PostGIS ST_Within for the spatial query
router.get('/:id/devices', requireAuth, async (req, res) => {
  try {
    const devices = await db.all(
      `SELECT d.device_code, d.name, d.location_label,
              d.status, d.gps_lat, d.gps_lng,
              ST_Distance(d.location::geography,
                          ST_Centroid(g.geom)::geography) AS distance_m
       FROM devices d, geofences g
       WHERE g.id = $1
         AND d.location IS NOT NULL
         AND ST_Within(d.location, g.geom)
       ORDER BY distance_m ASC`,
      [req.params.id]
    );
    res.json({ success: true, devices, count: devices.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
