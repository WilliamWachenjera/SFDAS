// services/mqttService.js — PostGIS Edition
// Key change: ALL geofence checks now use PostGIS spatial SQL
// instead of the JavaScript Haversine formula.
//
// PostGIS functions used:
//   ST_Within(point, polygon)        — is device inside geofence?
//   ST_DWithin(geog_a, geog_b, m)    — is device within N metres?
//   ST_SetSRID(ST_MakePoint(lng,lat), 4326) — build a point from coordinates
//
// Everything else (MQTT topics, fire logic, Socket.IO) is unchanged.

require('dotenv').config();
const mqtt = require('mqtt');
const { v4: uuidv4 } = require('uuid');

let _db, _notify, _logger;
const db     = () => _db     || (_db     = require('../db/database'));
const notify = () => _notify || (_notify = require('./notifyService'));
const log    = () => _logger || (_logger = require('./logger'));

let client = null;


async function checkGeofencePostGIS(lat, lng) {
  if (lat == null || lng == null) return null;

  // Get the active geofence geometry from the database
  const geo = await db().get(
    'SELECT id, geom FROM geofences WHERE is_active = 1 AND geom IS NOT NULL LIMIT 1'
  );
  if (!geo || !geo.geom) return null;

  // ST_Within checks if the device point falls inside the stored geometry.
  // We cast to geography for accurate metre-based measurements.
  // SRID 4326 = WGS84 (standard GPS coordinate system).
  const result = await db().get(
    `SELECT ST_Within(
       ST_SetSRID(ST_MakePoint($1, $2), 4326),
       geom
     ) AS inside
     FROM geofences
     WHERE id = $3`,
    [lng, lat, geo.id]   // NOTE: PostGIS uses (longitude, latitude) order
  );

  return result?.inside ?? null;
}


async function getDistanceToGeofence(lat, lng) {
  if (lat == null || lng == null) return null;
  const result = await db().get(
    `SELECT ROUND(
       ST_Distance(
         ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
         ST_Centroid(geom)::geography
       )
     ) AS distance_m
     FROM geofences
     WHERE is_active = 1 AND geom IS NOT NULL
     LIMIT 1`,
    [lng, lat]
  );
  return result?.distance_m ?? null;
}


async function getNearbyIncidents(lat, lng, radiusMetres = 200) {
  if (lat == null || lng == null) return [];
  return db().all(
    `SELECT id, incident_code, severity, detected_at,
            ROUND(ST_Distance(
              location::geography,
              ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
            )) AS distance_m
     FROM incidents
     WHERE ST_DWithin(
       location::geography,
       ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
       $3
     )
     AND status != 'resolved'
     ORDER BY distance_m ASC`,
    [lng, lat, radiusMetres]
  );
}


async function getThresholds() {
  const rows = await db().all('SELECT key, value FROM system_config');
  const t = {};
  rows.forEach(r => { t[r.key] = parseFloat(r.value); });
  return {
    smoke_warning:  t.smoke_warning  ?? 250,
    smoke_critical: t.smoke_critical ?? 500,
    temp_warning:   t.temp_warning   ?? 50,
    temp_critical:  t.temp_critical  ?? 100,
    gas_warning:    t.gas_warning    ?? 150,
    gas_critical:   t.gas_critical   ?? 300,
  };
}

function getSeverity(smoke, temp, gas, flame, t) {
  if (flame || smoke >= t.smoke_critical || temp >= t.temp_critical || gas >= t.gas_critical) return 'critical';
  if (smoke >= t.smoke_warning  || temp >= t.temp_warning  || gas >= t.gas_warning)           return 'warning';
  return 'low';
}

async function handleSensorData(deviceCode, payload, io) {
  let data;
<<<<<<< HEAD
  try { data = JSON.parse(payload); } catch (_) {
    log().warn(`[MQTT] Invalid JSON from ${deviceCode}`); return;
  }
  const { smoke_ppm, temperature_c, gas_ppm, humidity_pct,
          battery_pct, flame_detected, lat, lng } = data;

  // ── 1. Upsert device — update PostGIS location point ──────────
  let device = await db().get('SELECT * FROM devices WHERE device_code = $1', [deviceCode]);

  if (!device) {
    // Auto-register unknown device
    // ST_SetSRID(ST_MakePoint(lng, lat), 4326) builds a PostGIS point
    await db().query(
      `INSERT INTO devices
         (device_code, name, location_label, status,
          gps_lat, gps_lng, location,
          smoke_ppm, temperature_c, gas_ppm, humidity_pct,
          battery_pct, flame_detected, last_seen, seconds_since_seen, api_key)
       VALUES ($1,$2,$3,'online',
               $4,$5, ST_SetSRID(ST_MakePoint($5,$4), 4326),
               $6,$7,$8,$9,$10,$11,NOW(),0,$12)`,
      [deviceCode, `Device ${deviceCode}`, '',
       lat ?? null, lng ?? null,
       smoke_ppm ?? null, temperature_c ?? null,
       gas_ppm ?? null, humidity_pct ?? null,
       battery_pct ?? null, flame_detected ? 1 : 0,
       uuidv4()]
    );
    log().info(`[MQTT] Auto-registered device: ${deviceCode}`);
  } else {
    // Update existing device — rebuild the PostGIS point if GPS changed
    await db().query(
      `UPDATE devices SET
         status            = 'online',
         gps_lat           = COALESCE($1, gps_lat),
         gps_lng           = COALESCE($2, gps_lng),
         location          = CASE
                               WHEN $1 IS NOT NULL AND $2 IS NOT NULL
                               THEN ST_SetSRID(ST_MakePoint($2, $1), 4326)
                               ELSE location
                             END,
         smoke_ppm         = COALESCE($3, smoke_ppm),
         temperature_c     = COALESCE($4, temperature_c),
         gas_ppm           = COALESCE($5, gas_ppm),
         humidity_pct      = COALESCE($6, humidity_pct),
         battery_pct       = COALESCE($7, battery_pct),
         flame_detected    = COALESCE($8, flame_detected),
         last_seen         = NOW(),
         seconds_since_seen = 0
       WHERE device_code = $9`,
      [lat ?? null, lng ?? null,
       smoke_ppm ?? null, temperature_c ?? null,
       gas_ppm ?? null, humidity_pct ?? null,
       battery_pct ?? null, flame_detected ? 1 : 0,
       deviceCode]
    );
  }
  device = await db().get('SELECT * FROM devices WHERE device_code = $1', [deviceCode]);

  // ── 2. Save time-series reading with PostGIS point ─────────────
  await db().query(
    `INSERT INTO sensor_readings
       (device_id, device_code, smoke_ppm, temperature_c,
        gas_ppm, humidity_pct, battery_pct, flame_detected,
        gps_lat, gps_lng, location)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
             CASE WHEN $9 IS NOT NULL AND $10 IS NOT NULL
                  THEN ST_SetSRID(ST_MakePoint($10,$9), 4326)
                  ELSE NULL END)`,
    [device.id, deviceCode,
     smoke_ppm ?? null, temperature_c ?? null,
     gas_ppm ?? null, humidity_pct ?? null,
     battery_pct ?? null, flame_detected ? 1 : 0,
     lat ?? device.gps_lat, lng ?? device.gps_lng]
  );

  // ── 3. Push live reading to dashboard ──────────────────────────
  io?.emit('sensor:reading', {
    deviceCode, smoke_ppm, temperature_c, gas_ppm,
    humidity_pct, battery_pct, flame_detected,
    gps_lat: lat ?? device.gps_lat,
    gps_lng: lng ?? device.gps_lng,
    ts: new Date().toISOString(),
  });

  // ── 4. Fire detection ───────────────────────────────────────────
  const t = await getThresholds();
  const isFire = flame_detected
    || (smoke_ppm      != null && smoke_ppm      >= t.smoke_warning)
    || (temperature_c  != null && temperature_c  >= t.temp_warning)
    || (gas_ppm        != null && gas_ppm        >= t.gas_warning);

  if (!isFire) return;

  const existing = await db().get(
    `SELECT id FROM incidents WHERE device_code = $1
     AND status IN ('active','monitoring','acknowledged')`,
    [deviceCode]
  );
  if (existing) return;

  // ── 5. PostGIS geofence check ───────────────────────────────────
  // This is the key replacement for the Haversine formula.
  // ST_Within is performed entirely inside PostgreSQL using
  // the spatial index — accurate and fast.
  const effectiveLat = lat ?? device.gps_lat;
  const effectiveLng = lng ?? device.gps_lng;

  const insideGeo  = await checkGeofencePostGIS(effectiveLat, effectiveLng);
  const distanceM  = await getDistanceToGeofence(effectiveLat, effectiveLng);
  const nearby     = await getNearbyIncidents(effectiveLat, effectiveLng, 200);

  log().info(
    `[PostGIS] Device ${deviceCode} — inside geofence: ${insideGeo}, ` +
    `distance to centre: ${distanceM}m, nearby incidents: ${nearby.length}`
  );

  // ── 6. Create incident with PostGIS location point ──────────────
  const severity = getSeverity(smoke_ppm, temperature_c, gas_ppm, flame_detected, t);
  const incCode  = `INC-${new Date().getFullYear()}-${uuidv4().replace(/-/g,'').slice(0,6).toUpperCase()}`;

  const result = await db().query(
    `INSERT INTO incidents
       (incident_code, device_id, device_code, location_label,
        severity, status, smoke_ppm, temperature_c,
        gas_ppm, humidity_pct, flame_detected,
        gps_lat, gps_lng, location, inside_geofence)
     VALUES ($1,$2,$3,$4,
             $5,'active',$6,$7,$8,$9,$10,
             $11,$12,
             CASE WHEN $11 IS NOT NULL AND $12 IS NOT NULL
                  THEN ST_SetSRID(ST_MakePoint($12,$11), 4326)
                  ELSE NULL END,
             $13)
     RETURNING id`,
    [incCode, device.id, deviceCode, device.location_label || '',
     severity,
     smoke_ppm ?? null, temperature_c ?? null,
     gas_ppm ?? null, humidity_pct ?? null,
     flame_detected ? 1 : 0,
     effectiveLat, effectiveLng,
     insideGeo === null ? null : (insideGeo ? 1 : 0)]
  );
  const incidentId = result.rows[0].id;

  await db().query(
    'INSERT INTO incident_events (incident_id, event_type, description) VALUES ($1,$2,$3)',
    [incidentId, 'detected',
     `Smoke:${smoke_ppm}ppm Temp:${temperature_c}°C Flame:${flame_detected} | PostGIS inside:${insideGeo} dist:${distanceM}m`]
  );

  // ── 7. Auto sprinkler for critical ─────────────────────────────
  if (severity === 'critical') {
    client?.publish(
      `sfdaass/sprinkler/${deviceCode}`,
      JSON.stringify({ activate: true, incident: incCode }),
      { qos: 1 }
    );
    await db().query('UPDATE incidents SET sprinkler_activated = 1 WHERE id = $1', [incidentId]);
    await db().query(
      'INSERT INTO incident_events (incident_id, event_type, description) VALUES ($1,$2,$3)',
      [incidentId, 'sprinkler_activated', 'Auto sprinkler activation triggered']
    );
    log().warn(`[MQTT] 💧 Sprinkler command sent → ${deviceCode}`);
  }

  // ── 8. Broadcast to dashboard ───────────────────────────────────
  const incident = await db().get('SELECT * FROM incidents WHERE id = $1', [incidentId]);
  io?.emit('incident:created', { ...incident, nearby_count: nearby.length, distance_to_fence_m: distanceM });
  log().warn(`[MQTT] 🔥 ${incCode} | ${deviceCode} | ${severity} | inside_geofence:${insideGeo}`);

  // ── 9. Notifications ────────────────────────────────────────────
  const msg =
    `🔥 FIRE ALERT [${severity.toUpperCase()}]\n` +
    `Device   : ${deviceCode} — ${device.location_label || 'Unknown'}\n` +
    `Smoke    : ${smoke_ppm} ppm\n` +
    `Temp     : ${temperature_c}°C\n` +
    `Flame    : ${flame_detected ? 'YES' : 'NO'}\n` +
    `GPS      : ${effectiveLat}, ${effectiveLng}\n` +
    `Geofence : ${insideGeo === null ? 'N/A' : insideGeo ? '✅ Inside' : '❌ OUTSIDE'}\n` +
    `Distance : ${distanceM != null ? distanceM + 'm from fence centre' : 'N/A'}\n` +
    `Nearby   : ${nearby.length} other active incident(s) within 200m\n` +
    `Incident : ${incCode}`;

  notify().sendSMS(msg).then(ok => {
    if (ok) db().query('UPDATE incidents SET sms_sent = 1 WHERE id = $1', [incidentId]);
  }).catch(() => {});

  notify().sendEmail({
    subject: `[SFDAASS] ${incCode} — ${severity.toUpperCase()} Fire Alert`,
    text: msg,
    html: `<div style="background:#ff4e1a;color:white;padding:16px;border-radius:8px;font-family:sans-serif">
             <h2>🔥 FIRE ALERT — ${severity.toUpperCase()}</h2>
           </div>
           <pre style="padding:12px;background:#fff3f3;border:1px solid #ffcccc;border-radius:6px">${msg}</pre>`,
  }).then(ok => {
    if (ok) db().query('UPDATE incidents SET email_sent = 1 WHERE id = $1', [incidentId]);
  }).catch(() => {});
=======
  try { data = JSON.parse(payload); } catch (_) { return; }

  const smoke_ppm = data.smoke_ppm ?? data.smoke;
  try {
    const data = JSON.parse(payload);
    await db().query(
      `UPDATE devices SET status = $1, last_seen = NOW(), seconds_since_seen = 0
       WHERE device_code = $2`,
      [data.status || 'online', deviceCode]
    );
    io?.emit('device:status', { deviceCode, status: data.status || 'online' });
  } catch (_) {}
}


async function handleGPS(deviceCode, payload, io) {
  try {
    const { lat, lng } = JSON.parse(payload);
    await db().query(
      `UPDATE devices SET
         gps_lat  = $1,
         gps_lng  = $2,
         location = ST_SetSRID(ST_MakePoint($2, $1), 4326)
       WHERE device_code = $3`,
      [lat, lng, deviceCode]
    );
    io?.emit('gps:update', { deviceCode, lat, lng });
  } catch (_) {}
}


function connectMQTT(io) {
  const host     = process.env.MQTT_HOST?.trim();
  const port     = parseInt(process.env.MQTT_PORT) || 8883;
  const username = process.env.MQTT_USERNAME?.trim();
  const password = process.env.MQTT_PASSWORD?.trim();

  if (!host || !username || !password) {
    log().error('[MQTT] ❌ Missing MQTT credentials in .env'); return null;
  }

<<<<<<< HEAD
  const brokerUrl = `tls://${host}:${port}`;
  log().info(`[MQTT] Connecting to HiveMQ → ${brokerUrl}`);
=======
  const protocol = process.env.MQTT_USE_TLS === 'true' ? 'mqtts' : 'mqtt';
  const brokerUrl = `${protocol}://${host}:${port}`;
  log().info(`[MQTT] Attempting connection → ${brokerUrl}`);
>>>>>>> 21df124098a1a0d97f63d07d7d1f6388728a2783

  client = mqtt.connect(brokerUrl, {
    clientId:           `sfdaass-backend-${Date.now()}`,
    username,
    password,
    rejectUnauthorized: false,
<<<<<<< HEAD
    reconnectPeriod:    10000,
    connectTimeout:     60000,
    keepalive:          60,
    clean:              true,
  });
=======
    reconnectPeriod: 10000,
    connectTimeout: 60000,
    keepalive: 60,
    clean: true,
    protocolVersion: 4
  };

  client = mqtt.connect(brokerUrl, options);
>>>>>>> 21df124098a1a0d97f63d07d7d1f6388728a2783

  client.on('connect', () => {
    log().info('[MQTT] ✅ Connected to HiveMQ Cloud');
    ['sfdaass/sensors/#', 'sfdaass/alert/#', 'sfdaass/status/#', 'sfdaass/gps/#'].forEach(t => {
      client.subscribe(t, { qos: 1 }, err => {
        if (err) log().error(`Subscribe failed: ${t}`);
        else     log().info(`[MQTT] Subscribed → ${t}`);
      });
    });
  });

  client.on('error',     err => log().error(`[MQTT] Error: ${err.message}`));
  client.on('reconnect', ()  => log().warn('[MQTT] 🔄 Reconnecting...'));
  client.on('offline',   ()  => log().warn('[MQTT] 📴 Offline'));
  client.on('close',     ()  => log().warn('[MQTT] Connection closed'));

  client.on('message', (topic, message) => {
    const payload = message.toString();
    const parts   = topic.split('/');
    if (parts.length < 3) return;
    const [, category, deviceCode] = parts;
    if (category === 'sensors' || category === 'alert') handleSensorData(deviceCode, payload, io);
    else if (category === 'status') handleStatus(deviceCode, payload, io);
    else if (category === 'gps')    handleGPS(deviceCode, payload, io);
  });

<<<<<<< HEAD
  // ── Mark stale devices offline every 30 seconds ──────────────
  setInterval(async () => {
    await db().query(
      `UPDATE devices
       SET status = 'offline',
           seconds_since_seen = EXTRACT(EPOCH FROM (NOW() - last_seen))::INTEGER
       WHERE last_seen < NOW() - INTERVAL '120 seconds'
         AND status != 'offline'`
    );
    await db().query(
      `UPDATE devices
       SET seconds_since_seen = EXTRACT(EPOCH FROM (NOW() - last_seen))::INTEGER
       WHERE last_seen IS NOT NULL`
    );
    io?.emit('system:heartbeat', { ts: new Date().toISOString() });
=======
  // System heartbeat every 30s
  setInterval(() => {
    const connectedClients = io?.engine?.clientsCount || 0;
    io?.emit('system:heartbeat', { connectedClients, ts: new Date().toISOString() });
    // Mark stale devices offline
    db().run(`UPDATE devices SET status = 'offline' WHERE last_seen < datetime('now', '-120 seconds') AND status != 'offline'`);
>>>>>>> 21df124098a1a0d97f63d07d7d1f6388728a2783
  }, 30000);

  return client;
}

function getClient() { return client; }

module.exports = { connectMQTT, getClient, checkGeofencePostGIS, getDistanceToGeofence, getNearbyIncidents };
