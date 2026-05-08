// =============================================================
// services/mqttService.js  —  HiveMQ Cloud Edition
// =============================================================
//
// WHAT CHANGED FROM LOCAL MOSQUITTO VERSION:
//   - Uses TLS (port 8883) instead of plain TCP (port 1883)
//   - Connects with username + password (HiveMQ requires this)
//   - Uses mqtt.connect() with tls options object
//   - Everything else (topics, fire logic, Socket.IO) is identical
//
// PARAMETERS TO SET IN YOUR .env FILE:
//   MQTT_HOST      = abc123.s1.eu.hivemq.cloud   (your cluster host)
//   MQTT_PORT      = 8883
//   MQTT_USERNAME  = sfdaass_device               (your HiveMQ credential)
//   MQTT_PASSWORD  = SecurePass123                (your HiveMQ credential)
//   MQTT_USE_TLS   = true
//
// TOPICS:
//   ESP32  → Backend  (backend subscribes)
//     sfdaass/sensors/{DEVICE_CODE}    sensor data every 5s
//     sfdaass/alert/{DEVICE_CODE}      explicit fire alert
//     sfdaass/status/{DEVICE_CODE}     heartbeat
//     sfdaass/gps/{DEVICE_CODE}        GPS position
//
//   Backend → ESP32  (backend publishes)
//     sfdaass/sprinkler/{DEVICE_CODE}  {"activate": true/false}
//     sfdaass/config/{DEVICE_CODE}     threshold updates
//
// =============================================================

require('dotenv').config();
const mqtt = require('mqtt');
const { v4: uuidv4 } = require('uuid');

// ── lazy-load db and services after db.init() is done ────
let _db;
function db() { if (!_db) _db = require('../db/database'); return _db; }

let _notify;
function notify() { if (!_notify) _notify = require('./notifyService'); return _notify; }

let _logger;
function log() { if (!_logger) _logger = require('./logger'); return _logger; }

// The live MQTT client — exported so routes can publish commands
let client = null;

// =============================================================
// GEOFENCE HELPERS
// =============================================================
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const r = d => (d * Math.PI) / 180;
  const dLat = r(lat2 - lat1);
  const dLon = r(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointInPolygon(lat, lng, polygon) {
  let inside = false;
  const n = polygon.length;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;
    if (((yi > lng) !== (yj > lng)) &&
        (lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi)) inside = !inside;
    j = i;
  }
  return inside;
}

function checkGeofence(lat, lng) {
  if (!lat || !lng) return null;
  const geo = db().get('SELECT * FROM geofences WHERE is_active = 1 LIMIT 1');
  if (!geo) return null;
  if (geo.type === 'circle') {
    return haversine(lat, lng, geo.center_lat, geo.center_lng) <= geo.radius_meters;
  }
  if (geo.type === 'polygon' && geo.polygon_coords) {
    try { return pointInPolygon(lat, lng, JSON.parse(geo.polygon_coords)); }
    catch (_) { return null; }
  }
  return null;
}

// =============================================================
// THRESHOLD + SEVERITY HELPERS
// =============================================================
function getThresholds() {
  const rows = db().all('SELECT key, value FROM system_config');
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
  if (flame || smoke >= t.smoke_critical || temp >= t.temp_critical || gas >= t.gas_critical)
    return 'critical';
  if (smoke >= t.smoke_warning || temp >= t.temp_warning || gas >= t.gas_warning)
    return 'warning';
  return 'low';
}

// =============================================================
// MESSAGE HANDLERS
// =============================================================

// ── sfdaass/sensors/{deviceCode} and sfdaass/alert/{deviceCode}
async function handleSensorData(deviceCode, payload, io) {
  let data;
  try { data = JSON.parse(payload); }
  catch (_) {
    log().warn(`[MQTT] Invalid JSON from ${deviceCode}: ${payload.slice(0, 80)}`);
    return;
  }

  const { smoke_ppm, temperature_c, gas_ppm, humidity_pct,
          battery_pct, flame_detected, lat, lng } = data;

  // 1 ── Upsert device record ────────────────────────────
  let device = db().get('SELECT * FROM devices WHERE device_code = ?', [deviceCode]);
  if (!device) {
    db().run(
      `INSERT INTO devices
         (device_code, name, location_label, status, gps_lat, gps_lng,
          smoke_ppm, temperature_c, gas_ppm, humidity_pct, battery_pct,
          flame_detected, last_seen, seconds_since_seen, api_key)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),0,?)`,
      [deviceCode, `Device ${deviceCode}`, '', 'online',
       lat ?? null, lng ?? null,
       smoke_ppm ?? null, temperature_c ?? null, gas_ppm ?? null,
       humidity_pct ?? null, battery_pct ?? null,
       flame_detected ? 1 : 0, uuidv4()]
    );
    log().info(`[MQTT] Auto-registered device: ${deviceCode}`);
  } else {
    db().run(
      `UPDATE devices SET
         status = 'online',
         gps_lat        = COALESCE(?, gps_lat),
         gps_lng        = COALESCE(?, gps_lng),
         smoke_ppm      = COALESCE(?, smoke_ppm),
         temperature_c  = COALESCE(?, temperature_c),
         gas_ppm        = COALESCE(?, gas_ppm),
         humidity_pct   = COALESCE(?, humidity_pct),
         battery_pct    = COALESCE(?, battery_pct),
         flame_detected = COALESCE(?, flame_detected),
         last_seen      = datetime('now'),
         seconds_since_seen = 0
       WHERE device_code = ?`,
      [lat ?? null, lng ?? null, smoke_ppm ?? null, temperature_c ?? null,
       gas_ppm ?? null, humidity_pct ?? null, battery_pct ?? null,
       flame_detected ? 1 : 0, deviceCode]
    );
  }
  device = db().get('SELECT * FROM devices WHERE device_code = ?', [deviceCode]);

  // 2 ── Save time-series reading ────────────────────────
  db().run(
    `INSERT INTO sensor_readings
       (device_id, device_code, smoke_ppm, temperature_c, gas_ppm,
        humidity_pct, battery_pct, flame_detected, gps_lat, gps_lng)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [device.id, deviceCode, smoke_ppm ?? null, temperature_c ?? null,
     gas_ppm ?? null, humidity_pct ?? null, battery_pct ?? null,
     flame_detected ? 1 : 0, lat ?? device.gps_lat, lng ?? device.gps_lng]
  );

  // 3 ── Push live reading to dashboard ─────────────────
  io?.emit('sensor:reading', {
    deviceCode, smoke_ppm, temperature_c, gas_ppm,
    humidity_pct, battery_pct, flame_detected,
    gps_lat: lat ?? device.gps_lat,
    gps_lng: lng ?? device.gps_lng,
    ts: new Date().toISOString(),
  });

  // 4 ── Fire detection ──────────────────────────────────
  const t = getThresholds();
  const isFire = flame_detected
    || (smoke_ppm    != null && smoke_ppm    >= t.smoke_warning)
    || (temperature_c != null && temperature_c >= t.temp_warning)
    || (gas_ppm      != null && gas_ppm      >= t.gas_warning);

  if (!isFire) return;

  // Don't create duplicate incidents
  const existing = db().get(
    `SELECT id FROM incidents WHERE device_code = ?
     AND status IN ('active','monitoring','acknowledged')`,
    [deviceCode]
  );
  if (existing) return;

  // 5 ── Create incident ─────────────────────────────────
  const severity  = getSeverity(smoke_ppm, temperature_c, gas_ppm, flame_detected, t);
  const insideGeo = checkGeofence(lat ?? device.gps_lat, lng ?? device.gps_lng);
  const incCode   = `INC-${new Date().getFullYear()}-${uuidv4().replace(/-/g,'').slice(0,6).toUpperCase()}`;

  const result = db().run(
    `INSERT INTO incidents
       (incident_code, device_id, device_code, location_label,
        severity, status, smoke_ppm, temperature_c, gas_ppm,
        humidity_pct, flame_detected, gps_lat, gps_lng, inside_geofence)
     VALUES (?,?,?,?, ?,  'active', ?,?,?,?,?,?,?,?)`,
    [incCode, device.id, deviceCode, device.location_label || '',
     severity, smoke_ppm ?? null, temperature_c ?? null,
     gas_ppm ?? null, humidity_pct ?? null, flame_detected ? 1 : 0,
     lat ?? device.gps_lat, lng ?? device.gps_lng,
     insideGeo === null ? null : (insideGeo ? 1 : 0)]
  );
  const incidentId = result.lastID;

  db().run(
    `INSERT INTO incident_events (incident_id, event_type, description)
     VALUES (?,?,?)`,
    [incidentId, 'detected',
     `Smoke:${smoke_ppm}ppm Temp:${temperature_c}°C Flame:${flame_detected}`]
  );

  // 6 ── Auto sprinkler for critical ─────────────────────
  if (severity === 'critical') {
    client?.publish(
      `sfdaass/sprinkler/${deviceCode}`,
      JSON.stringify({ activate: true, incident: incCode }),
      { qos: 1 }
    );
    db().run('UPDATE incidents SET sprinkler_activated = 1 WHERE id = ?', [incidentId]);
    db().run(
      `INSERT INTO incident_events (incident_id, event_type, description)
       VALUES (?,?,?)`,
      [incidentId, 'sprinkler_activated', 'Auto sprinkler activation triggered']
    );
    log().warn(`[MQTT] 💧 Sprinkler command sent → ${deviceCode}`);
  }

  // 7 ── Broadcast to dashboard ──────────────────────────
  const incident = db().get('SELECT * FROM incidents WHERE id = ?', [incidentId]);
  io?.emit('incident:created', incident);
  log().warn(`[MQTT] 🔥 ${incCode} | ${deviceCode} | ${severity}`);

  // 8 ── Notify ──────────────────────────────────────────
  const msg =
    `🔥 FIRE ALERT [${severity.toUpperCase()}]\n` +
    `Device  : ${deviceCode} — ${device.location_label || 'Unknown'}\n` +
    `Smoke   : ${smoke_ppm} ppm\n` +
    `Temp    : ${temperature_c}°C\n` +
    `Flame   : ${flame_detected ? 'YES' : 'NO'}\n` +
    `GPS     : ${lat ?? device.gps_lat}, ${lng ?? device.gps_lng}\n` +
    `Geofence: ${insideGeo === null ? 'N/A' : insideGeo ? 'Inside' : 'OUTSIDE'}\n` +
    `Incident: ${incCode}`;

  notify().sendSMS(msg).then(ok => {
    if (ok) db().run('UPDATE incidents SET sms_sent = 1 WHERE id = ?', [incidentId]);
  }).catch(() => {});

  notify().sendEmail({
    subject: `[SFDAASS] ${incCode} — ${severity.toUpperCase()} Fire Alert`,
    text: msg,
    html: `<div style="background:#ff4e1a;color:white;padding:16px;border-radius:8px;font-family:sans-serif">
             <h2>🔥 FIRE ALERT — ${severity.toUpperCase()}</h2>
           </div>
           <pre style="padding:12px;background:#fff3f3;border:1px solid #ffcccc;border-radius:6px">${msg}</pre>`,
  }).then(ok => {
    if (ok) db().run('UPDATE incidents SET email_sent = 1 WHERE id = ?', [incidentId]);
  }).catch(() => {});
}

// ── sfdaass/status/{deviceCode} ──────────────────────────
function handleStatus(deviceCode, payload, io) {
  try {
    const data = JSON.parse(payload);
    db().run(
      `UPDATE devices SET status = ?, last_seen = datetime('now'),
       seconds_since_seen = 0 WHERE device_code = ?`,
      [data.status || 'online', deviceCode]
    );
    io?.emit('device:status', { deviceCode, status: data.status || 'online' });
  } catch (_) {}
}

// ── sfdaass/gps/{deviceCode} ─────────────────────────────
function handleGPS(deviceCode, payload, io) {
  try {
    const { lat, lng } = JSON.parse(payload);
    db().run(
      'UPDATE devices SET gps_lat = ?, gps_lng = ? WHERE device_code = ?',
      [lat, lng, deviceCode]
    );
    io?.emit('gps:update', { deviceCode, lat, lng });
  } catch (_) {}
}

// =============================================================
// connectMQTT()  —  called once from server.js
// =============================================================
function connectMQTT(io) {

  // ── Read settings from .env ───────────────────────────
  const host     = process.env.MQTT_HOST     || 'YOUR_CLUSTER.s1.eu.hivemq.cloud';
  const port     = parseInt(process.env.MQTT_PORT) || 8883;
  const username = process.env.MQTT_USERNAME || '';
  const password = process.env.MQTT_PASSWORD || '';
  const useTLS   = process.env.MQTT_USE_TLS  !== 'false'; // default true for HiveMQ

  // ── Build connection options ──────────────────────────
  const options = {
    clientId:        `sfdaass-backend-${Date.now()}`,
    username,
    password,
    reconnectPeriod: 5000,     // retry every 5s
    connectTimeout:  15000,    // HiveMQ cloud can take a moment
    keepalive:       60,
    clean:           true,
  };

  // HiveMQ cloud ALWAYS requires TLS on port 8883
  if (useTLS) {
    options.protocol = 'mqtts';  // <── this is the key change vs Mosquitto
  }

  const brokerUrl = `${useTLS ? 'mqtts' : 'mqtt'}://${host}:${port}`;
  log().info(`[MQTT] Connecting to HiveMQ at ${brokerUrl} …`);

  client = mqtt.connect(brokerUrl, options);

  // ── Events ───────────────────────────────────────────
  client.on('connect', () => {
    log().info('[MQTT] ✅ Connected to HiveMQ Cloud');

    const topics = [
      'sfdaass/sensors/#',
      'sfdaass/alert/#',
      'sfdaass/status/#',
      'sfdaass/gps/#',
    ];

    topics.forEach(t => {
      client.subscribe(t, { qos: 1 }, (err) => {
        if (err) log().error(`[MQTT] Subscribe failed for ${t}: ${err.message}`);
        else     log().info(`[MQTT] Subscribed: ${t}`);
      });
    });
  });

  client.on('error', err => {
    log().error(`[MQTT] Error: ${err.message}`);
    // Common HiveMQ errors and their meaning:
    // Connection refused, not authorized  → wrong username/password
    // ECONNREFUSED                        → wrong host or port
    // certificate errors                  → set rejectUnauthorized: false (dev only)
  });

  client.on('offline',   () => log().warn('[MQTT] Offline — will retry'));
  client.on('reconnect', () => log().info('[MQTT] Reconnecting to HiveMQ…'));
  client.on('close',     () => log().warn('[MQTT] Connection closed'));

  // ── Message dispatcher ───────────────────────────────
  client.on('message', (topic, message) => {
    const payload = message.toString();
    log().debug(`[MQTT] ← [${topic}] ${payload.slice(0, 120)}`);

    const parts = topic.split('/');
    if (parts.length < 3) return;

    const category   = parts[1];  // sensors | alert | status | gps
    const deviceCode = parts[2];  // e.g. ESP32-001

    switch (category) {
      case 'sensors': handleSensorData(deviceCode, payload, io); break;
      case 'alert':   handleSensorData(deviceCode, payload, io); break;
      case 'status':  handleStatus(deviceCode, payload, io);     break;
      case 'gps':     handleGPS(deviceCode, payload, io);        break;
    }
  });

  // ── Periodic background tasks ────────────────────────
  setInterval(() => {
    // Mark devices offline if silent for 2 minutes
    db().run(
      `UPDATE devices
       SET status = 'offline',
           seconds_since_seen = CAST(
             (julianday('now') - julianday(last_seen)) * 86400 AS INTEGER)
       WHERE last_seen < datetime('now', '-120 seconds')
         AND status != 'offline'`
    );
    db().run(
      `UPDATE devices
       SET seconds_since_seen = CAST(
             (julianday('now') - julianday(last_seen)) * 86400 AS INTEGER)
       WHERE last_seen IS NOT NULL`
    );
    io?.emit('system:heartbeat', { ts: new Date().toISOString() });
  }, 30000);

  return client;
}

function getClient() { return client; }

module.exports = { connectMQTT, getClient };
