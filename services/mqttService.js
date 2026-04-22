// services/mqttService.js
// MQTT Bridge: listens to ESP32 → processes fire detection → pushes to dashboard

const mqtt = require('mqtt');
const db = require('../db/database');
const logger = require('./logger');
const notifyService = require('./notifyService');
const { v4: uuidv4 } = require('uuid');

let client = null;

// ── Haversine distance in meters ──────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function checkGeofence(lat, lng) {
  const geo = db.get('SELECT * FROM geofences WHERE is_active = 1 LIMIT 1');
  if (!geo || !lat || !lng) return null;
  if (geo.type === 'circle') {
    const dist = haversine(lat, lng, geo.center_lat, geo.center_lng);
    return dist <= geo.radius_meters;
  }
  if (geo.type === 'polygon' && geo.polygon_coords) {
    try {
      const poly = JSON.parse(geo.polygon_coords);
      return pointInPolygon(lat, lng, poly);
    } catch (e) { return null; }
  }
  return null;
}

function pointInPolygon(lat, lng, polygon) {
  let inside = false;
  const n = polygon.length;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;
    if (((yi > lng) !== (yj > lng)) && (lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}

function getThresholds() {
  const rows = db.all('SELECT key, value FROM system_config');
  const t = {};
  rows.forEach(r => { t[r.key] = parseFloat(r.value); });
  return t;
}

function getSeverity(smoke, temp, gas, flame, thresholds) {
  if (flame || smoke >= thresholds.smoke_critical || temp >= thresholds.temp_critical || gas >= thresholds.gas_critical) return 'critical';
  if (smoke >= thresholds.smoke_warning || temp >= thresholds.temp_warning || gas >= thresholds.gas_warning) return 'warning';
  return 'low';
}

// ── Handle incoming sensor payload ────────────────────
async function handleSensorData(deviceCode, payload, io) {
  let data;
  try { data = JSON.parse(payload); } catch (e) { return; }

  const { smoke_ppm, temperature_c, gas_ppm, humidity_pct, battery_pct, flame_detected, lat, lng } = data;

  // Update / upsert device
  let device = db.get('SELECT * FROM devices WHERE device_code = ?', [deviceCode]);
  if (!device) {
    db.run(
      'INSERT INTO devices (device_code, name, location_label, status, gps_lat, gps_lng, smoke_ppm, temperature_c, gas_ppm, humidity_pct, battery_pct, flame_detected, last_seen, seconds_since_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime("now"), 0)',
      [deviceCode, deviceCode, `Device ${deviceCode}`, 'online', lat, lng, smoke_ppm, temperature_c, gas_ppm, humidity_pct, battery_pct, flame_detected ? 1 : 0]
    );
    device = db.get('SELECT * FROM devices WHERE device_code = ?', [deviceCode]);
  } else {
    db.run(
      `UPDATE devices SET status = 'online', gps_lat = COALESCE(?, gps_lat), gps_lng = COALESCE(?, gps_lng),
       smoke_ppm = COALESCE(?, smoke_ppm), temperature_c = COALESCE(?, temperature_c), gas_ppm = COALESCE(?, gas_ppm),
       humidity_pct = COALESCE(?, humidity_pct), battery_pct = COALESCE(?, battery_pct),
       flame_detected = COALESCE(?, flame_detected), last_seen = datetime('now'), seconds_since_seen = 0
       WHERE device_code = ?`,
      [lat, lng, smoke_ppm, temperature_c, gas_ppm, humidity_pct, battery_pct, flame_detected ? 1 : 0, deviceCode]
    );
    device = db.get('SELECT * FROM devices WHERE device_code = ?', [deviceCode]);
  }

  // Save time-series reading
  db.run(
    'INSERT INTO sensor_readings (device_id, device_code, smoke_ppm, temperature_c, gas_ppm, humidity_pct, battery_pct, flame_detected, gps_lat, gps_lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [device.id, deviceCode, smoke_ppm, temperature_c, gas_ppm, humidity_pct, battery_pct, flame_detected ? 1 : 0, lat || device.gps_lat, lng || device.gps_lng]
  );

  // Push live sensor update to dashboard
  io?.emit('sensor:reading', {
    deviceCode, smoke_ppm, temperature_c, gas_ppm, humidity_pct, battery_pct,
    flame_detected, gps_lat: lat || device.gps_lat, gps_lng: lng || device.gps_lng,
  });

  // ── Fire detection logic ───────────────────────────
  const thresholds = getThresholds();
  const isFire = flame_detected ||
    (smoke_ppm != null && smoke_ppm >= thresholds.smoke_warning) ||
    (temperature_c != null && temperature_c >= thresholds.temp_warning) ||
    (gas_ppm != null && gas_ppm >= thresholds.gas_warning);

  if (!isFire) return;

  // Don't create duplicate active incidents for same device
  const existing = db.get(
    `SELECT id FROM incidents WHERE device_code = ? AND status IN ('active','monitoring','acknowledged')`,
    [deviceCode]
  );
  if (existing) return;

  const severity = getSeverity(smoke_ppm, temperature_c, gas_ppm, flame_detected, thresholds);
  const insideGeo = checkGeofence(lat || device.gps_lat, lng || device.gps_lng);
  const incidentCode = `INC-${new Date().getFullYear()}-${uuidv4().replace(/-/g, '').substring(0, 6).toUpperCase()}`;

  // Create incident
  const result = db.run(
    `INSERT INTO incidents (incident_code, device_id, device_code, location_label, severity, status, smoke_ppm, temperature_c, gas_ppm, humidity_pct, flame_detected, gps_lat, gps_lng, inside_geofence)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [incidentCode, device.id, deviceCode, device.location_label, severity,
     smoke_ppm, temperature_c, gas_ppm, humidity_pct, flame_detected ? 1 : 0,
     lat || device.gps_lat, lng || device.gps_lng, insideGeo === null ? null : insideGeo ? 1 : 0]
  );

  const incidentId = result.lastID;

  // Add timeline event
  db.run(
    'INSERT INTO incident_events (incident_id, event_type, description) VALUES (?, ?, ?)',
    [incidentId, 'detected', `Fire condition detected: Smoke=${smoke_ppm}ppm, Temp=${temperature_c}°C, Flame=${flame_detected}`]
  );

  // Auto-activate sprinkler for critical
  if (severity === 'critical') {
    client?.publish(`sfdaass/sprinkler/${deviceCode}`, JSON.stringify({ activate: true, incident: incidentCode }));
    db.run(`UPDATE incidents SET sprinkler_activated = 1 WHERE id = ?`, [incidentId]);
    db.run(`UPDATE devices SET sprinkler_active = 1 WHERE device_code = ?`, [deviceCode]);
    db.run("INSERT INTO incident_events (incident_id, event_type, description) VALUES (?, ?, ?)",
      [incidentId, 'sprinkler_activated', 'Automatic sprinkler activation triggered']);
    logger.warn(`💧 Sprinkler activated for ${deviceCode} — ${incidentCode}`);
  }

  const incident = db.get('SELECT * FROM incidents WHERE id = ?', [incidentId]);

  // Push to all connected dashboards
  io?.emit('incident:created', incident);
  logger.warn(`🔥 FIRE INCIDENT: ${incidentCode} | Device: ${deviceCode} | Severity: ${severity}`);

  // Send notifications
  const alertMsg = `🔥 FIRE ALERT [${severity.toUpperCase()}]\nDevice: ${deviceCode} — ${device.location_label || 'Unknown'}\nSmoke: ${smoke_ppm}ppm | Temp: ${temperature_c}°C | Flame: ${flame_detected ? 'YES' : 'NO'}\nGPS: ${lat}, ${lng}\nIncident: ${incidentCode}`;

  notifyService.sendSMS(alertMsg).then(ok => {
    if (ok) db.run('UPDATE incidents SET sms_sent = 1 WHERE id = ?', [incidentId]);
    if (ok) db.run('INSERT INTO incident_events (incident_id, event_type, description) VALUES (?, ?, ?)', [incidentId, 'sms_sent', 'SMS alert sent']);
  }).catch(() => {});

  notifyService.sendEmail({
    subject: `[SFDAASS] ${incidentCode} — ${severity.toUpperCase()} Fire Alert`,
    text: alertMsg,
    html: `<div style="background:#ff4e1a;color:white;padding:16px;border-radius:8px;font-family:sans-serif"><h2>🔥 FIRE ALERT — ${severity.toUpperCase()}</h2></div><pre style="padding:12px;background:#fff3f3;border-radius:4px">${alertMsg}</pre>`,
  }).then(ok => {
    if (ok) db.run('UPDATE incidents SET email_sent = 1 WHERE id = ?', [incidentId]);
    if (ok) db.run('INSERT INTO incident_events (incident_id, event_type, description) VALUES (?, ?, ?)', [incidentId, 'email_sent', 'Email alert sent']);
  }).catch(() => {});
}

// ── Handle device status heartbeat ───────────────────
function handleStatus(deviceCode, payload) {
  try {
    const data = JSON.parse(payload);
    db.run(`UPDATE devices SET status = ?, last_seen = datetime('now'), seconds_since_seen = 0 WHERE device_code = ?`,
      [data.status || 'online', deviceCode]);
    global.io?.emit('device:status', { deviceCode, status: data.status || 'online' });
  } catch (e) {}
}

// ── Connect MQTT ───────────────────────────────────────
function connectMQTT(io) {
  const brokerUrl = `mqtt://${process.env.MQTT_HOST || 'localhost'}:${process.env.MQTT_PORT || 1883}`;

  client = mqtt.connect(brokerUrl, {
    clientId: `sfdaass-backend-${Date.now()}`,
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    reconnectPeriod: 3000,
    connectTimeout: 10000,
  });

  client.on('connect', () => {
    logger.info(`✅ MQTT connected to ${brokerUrl}`);
    client.subscribe('sfdaass/sensors/#');
    client.subscribe('sfdaass/alert/#');
    client.subscribe('sfdaass/status/#');
    client.subscribe('sfdaass/gps/#');
  });

  client.on('error', (err) => {
    logger.warn(`⚠ MQTT error: ${err.message} — system running without MQTT`);
  });

  client.on('offline', () => logger.warn('MQTT offline'));

  client.on('message', (topic, message) => {
    const payload = message.toString();
    const parts = topic.split('/');
    if (parts.length < 3) return;
    const [, category, deviceCode] = parts;

    logger.debug(`MQTT [${topic}]: ${payload.substring(0, 80)}`);

    if (category === 'sensors') handleSensorData(deviceCode, payload, io);
    else if (category === 'alert') handleSensorData(deviceCode, payload, io); // ESP32 fire alert
    else if (category === 'status') handleStatus(deviceCode, payload);
    else if (category === 'gps') {
      try {
        const { lat, lng } = JSON.parse(payload);
        db.run('UPDATE devices SET gps_lat = ?, gps_lng = ? WHERE device_code = ?', [lat, lng, deviceCode]);
        io?.emit('gps:update', { deviceCode, lat, lng });
      } catch (e) {}
    }
  });

  // Heartbeat to dashboard every 30s
  setInterval(() => {
    const connectedClients = io?.engine?.clientsCount || 0;
    io?.emit('system:heartbeat', { connectedClients, ts: new Date().toISOString() });
    // Mark stale devices offline
    db.run(`UPDATE devices SET status = 'offline' WHERE last_seen < datetime('now', '-120 seconds') AND status != 'offline'`);
  }, 30000);

  return client;
}

function getClient() { return client; }

module.exports = { connectMQTT, getClient };
