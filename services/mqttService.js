// services/mqttService.js
require('dotenv').config();
const mqtt = require('mqtt');
const { v4: uuidv4 } = require('uuid');

// Lazy load
let _db, _notify, _logger;
const db = () => _db || (_db = require('../db/database'));
const notify = () => _notify || (_notify = require('./notifyService'));
const log = () => _logger || (_logger = require('./logger'));

let client = null;

// =============================================================
// KEEP ALL YOUR HELPER FUNCTIONS HERE
// =============================================================
// (haversine, pointInPolygon, checkGeofence, getThresholds, getSeverity,
//  handleSensorData, handleStatus, handleGPS, etc.)
// 
// ←←← PASTE ALL YOUR EXISTING HELPER FUNCTIONS BELOW THIS LINE ←←←
// (I didn't change them, so keep them as they are)


<<<<<<< HEAD
// =============================================================
// FIXED + VERBOSE HIVEMQ CLOUD CONNECTION
// =============================================================
function connectMQTT(io) {
  const host     = process.env.MQTT_HOST?.trim();
  const port     = parseInt(process.env.MQTT_PORT) || 8883;
  const username = process.env.MQTT_USERNAME?.trim();
  const password = process.env.MQTT_PASSWORD?.trim();

  log().info(`[MQTT] Host: ${host}`);
  log().info(`[MQTT] Port: ${port}`);
  log().info(`[MQTT] Username: ${username || 'MISSING'}`);
  log().info(`[MQTT] Password length: ${password ? password.length : 0}`);
=======
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
      "INSERT INTO devices (device_code, name, location_label, status, gps_lat, gps_lng, smoke_ppm, temperature_c, gas_ppm, humidity_pct, battery_pct, flame_detected, last_seen, seconds_since_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 0)",
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
  const alertMsg = `🔥 FIRE ALERT [${severity.toUpperCase()}]\nDevice: ${deviceCode} — ${device.location_label || 'Unknown'}\nSmoke: ${smoke_ppm}ppm | Temp: ${temperature_c}°C | Flame: ${flame_detected ? 'YES' : 'NO'}\nGPS: ${lat || device.gps_lat}, ${lng || device.gps_lng}\nIncident: ${incidentCode}`;

  // Global SMS
  notifyService.sendSMS(alertMsg).then(ok => {
    if (ok) db.run('UPDATE incidents SET sms_sent = 1 WHERE id = ?', [incidentId]);
    if (ok) db.run('INSERT INTO incident_events (incident_id, event_type, description) VALUES (?, ?, ?)', [incidentId, 'sms_sent', 'SMS alert sent to Global Admins']);
  }).catch(() => {});

  // Owner SMS
  if (device.owner_phone) {
    notifyService.sendSMS(`⚠️ URGENT: ${alertMsg}`, device.owner_phone).catch(() => {});
  }

  // Global & Owner Email
  const emailRecipients = (process.env.ALERT_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
  if (device.owner_email) emailRecipients.push(device.owner_email);

  notifyService.sendEmail({
    to: emailRecipients,
    subject: `[SFDAASS] ${incidentCode} — ${severity.toUpperCase()} Fire Alert`,
    text: alertMsg,
    html: `<div style="background:#ff4e1a;color:white;padding:16px;border-radius:8px;font-family:sans-serif"><h2>🔥 FIRE ALERT — ${severity.toUpperCase()}</h2></div>
           <p>Location: <strong>${device.location_label}</strong></p>
           <pre style="padding:12px;background:#fff3f3;border-radius:4px">${alertMsg}</pre>
           ${device.owner_name ? `<p>Responsible Person: ${device.owner_name}</p>` : ''}`,
  }).then(ok => {
    if (ok) db.run('UPDATE incidents SET email_sent = 1 WHERE id = ?', [incidentId]);
    if (ok) db.run('INSERT INTO incident_events (incident_id, event_type, description) VALUES (?, ?, ?)', [incidentId, 'email_sent', 'Email alerts dispatched']);
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
  const host = process.env.MQTT_HOST || 'localhost';
  const port = process.env.MQTT_PORT || 1883;
  const useTls = process.env.MQTT_USE_TLS === 'true';
  const protocol = useTls ? 'mqtts' : 'mqtt';

  const brokerUrl = `${protocol}://${host}:${port}`;

  client = mqtt.connect(brokerUrl, {
    clientId: `sfdaass-backend-${Date.now()}`,
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    reconnectPeriod: 3000,
    connectTimeout: 10000,
    rejectUnauthorized: false, // For cloud brokers like HiveMQ that use TLS
  });
>>>>>>> 2ba0100b7b544844b636bdbadfd4501c57bf993e

  if (!host || !username || !password) {
    log().error('[MQTT] ❌ Missing MQTT credentials in .env file');
    return null;
  }

  const options = {
    clientId: `sfdaass-backend-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    username,
    password,
    rejectUnauthorized: false,        // Critical for HiveMQ Cloud free tier
    reconnectPeriod: 10000,
    connectTimeout: 45000,
    keepalive: 60,
    clean: true,
  };

  const brokerUrl = `tls://${host}:${port}`;
  log().info(`[MQTT] Attempting connection → ${brokerUrl}`);

  client = mqtt.connect(brokerUrl, options);

  // ── Successful Connection ─────────────────────────────
  client.on('connect', () => {
    log().info('🎉 ✅ SUCCESSFULLY CONNECTED TO HIVEMQ CLOUD!');

    const topics = [
      'sfdaass/sensors/#',
      'sfdaass/alert/#',
      'sfdaass/status/#',
      'sfdaass/gps/#'
    ];

    topics.forEach(topic => {
      client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) log().error(`[MQTT] Subscribe failed: ${topic}`);
        else log().info(`[MQTT] Subscribed → ${topic}`);
      });
    });
  });

  // ── Error Handling ───────────────────────────────────
  client.on('error', (err) => {
    log().error(`[MQTT] Error: ${err.message || err}`);
    if (err.code) log().error(`[MQTT] Error Code: ${err.code}`);
    
    if (err.message?.includes('authorized') || err.message?.includes('Not authorized')) {
      log().error('❌ Wrong username or password! Check your .env');
    }
    if (err.message?.includes('certificate') || err.code === 'CERT_HAS_EXPIRED') {
      log().error('⚠ TLS Certificate issue - rejectUnauthorized is already disabled');
    }
  });

  client.on('reconnect', () => log().warn('[MQTT] 🔄 Reconnecting to HiveMQ...'));
  client.on('offline', () => log().warn('[MQTT] 📴 MQTT Offline'));
  client.on('close', () => log().warn('[MQTT] Connection closed'));

  // ── Message Handler (unchanged) ───────────────────────
  client.on('message', (topic, message) => {
    const payload = message.toString();
    log().debug(`[MQTT] ← ${topic} | ${payload.slice(0, 100)}...`);

    const parts = topic.split('/');
    if (parts.length < 3) return;

    const category = parts[1];
    const deviceCode = parts[2];

    switch (category) {
      case 'sensors':
      case 'alert':
        handleSensorData(deviceCode, payload, io);
        break;
      case 'status':
        handleStatus(deviceCode, payload, io);
        break;
      case 'gps':
        handleGPS(deviceCode, payload, io);
        break;
    }
  });

  return client;
}

function getClient() { return client; }

module.exports = { connectMQTT, getClient };