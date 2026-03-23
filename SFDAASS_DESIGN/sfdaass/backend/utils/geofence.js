/**
 * Geofence utilities
 * Haversine distance + point-in-polygon (ray casting)
 */

const EARTH_RADIUS_M = 6371000;

/**
 * Haversine distance in metres between two lat/lng points
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Check if point is inside a circle geofence
 */
function isInsideCircle(lat, lng, centerLat, centerLng, radiusMeters) {
  const dist = haversineDistance(lat, lng, centerLat, centerLng);
  return { inside: dist <= radiusMeters, distance: Math.round(dist) };
}

/**
 * Ray-casting algorithm: check if point is inside polygon
 * coords: [{lat, lng}, ...]
 */
function isInsidePolygon(lat, lng, coords) {
  let inside = false;
  const n = coords.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = coords[i].lng, yi = coords[i].lat;
    const xj = coords[j].lng, yj = coords[j].lat;
    const intersect = ((yi > lat) !== (yj > lat)) &&
                      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return { inside, distance: null };
}

/**
 * Check if a GPS coordinate is inside a geofence object (from DB)
 */
function checkGeofence(lat, lng, geofence) {
  if (!geofence || lat == null || lng == null) return { inside: false, distance: null };

  if (geofence.type === 'circle') {
    return isInsideCircle(
      lat, lng,
      geofence.center_lat, geofence.center_lng,
      geofence.radius_meters
    );
  } else if (geofence.type === 'polygon' && Array.isArray(geofence.polygon_coords)) {
    return isInsidePolygon(lat, lng, geofence.polygon_coords);
  }

  return { inside: false, distance: null };
}

module.exports = { haversineDistance, isInsideCircle, isInsidePolygon, checkGeofence };
