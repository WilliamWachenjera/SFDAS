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
// HELPER FUNCTIONS
// =============================================================
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const r = d => (d * Math.PI) / 180;
  const dLat = r(lat2 - lat1);
  const dLon = r(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

function checkGeofence(lat, lng) {
  if (!lat || !lng) return null;
  const geo = db().get('SELECT * FROM geofences WHERE is_active = 1 LIMIT 1');
  if (!geo) return null;

  if (geo.type === 'circle') {
    return haversine(lat, lng, geo.center_lat, geo.center_lng) <= geo.radius_meters;
  }
  if (geo.type === 'polygon' && geo.polygon_coords) {
    try {
      return pointInPolygon(lat, lng, JSON.parse(geo.polygon_coords));
    } catch (_) { return null; }
  }
  return null;
}

function getThresholds() {
  const rows = db().all('SELECT key, value FROM system_config');
  const t = {};
  rows.forEach(r => { t[r.key] = parseFloat(r.value); });
  return {
    smoke_warning: t.smoke_warning ?? 250,
    smoke_critical: t.smoke_critical ?? 500,
    temp_warning: t.temp_warning ?? 50,
    temp_critical: t.temp_critical ?? 100,
    gas_warning: t.gas_warning ?? 150,
    gas_critical: t.gas_critical ?? 300,
  };
}

function getSeverity(smoke, temp, gas, flame, t) {
  if (flame || smoke >= t.smoke_critical || temp >= t.temp_critical || gas >= t.gas_critical) return 'critical';
  if (smoke >= t.smoke_warning || temp >= t.temp_warning || gas >= t.gas_warning) return 'warning';
  return 'low';
}

// =============================================================
// MESSAGE HANDLERS
// =============================================================
async function handleSensorData(deviceCode, payload, io) {
  let data;
  try { data = JSON.parse(payload); } catch (_) { return; }

  const { smoke_ppm, temperature_c, gas_ppm, humidity_pct, battery_pct, flame_detected, lat, lng } = data;

  // Upsert device
  let device = db().get('SELECT * FROM devices WHERE device_code = ?', [deviceCode]);
  if (!device) {
    db().run(`INSERT INTO devices (device_code, name, location_label, status, gps_lat, gps_lng, last_seen) 
              VALUES (?, ?, ?, 'online', ?, ?, datetime('now'))`, 
      [deviceCode, `Device ${deviceCode}`, '', lat, lng]);
    device = db().get('SELECT * FROM devices WHERE device_code = ?', [deviceCode]);
  } else {
    db().run(`UPDATE devices SET status='online', gps_lat=COALESCE(?,gps_lat), gps_lng=COALESCE(?,gps_lng), 
              last_seen=datetime('now'), seconds_since_seen=0 WHERE device_code=?`,
      [lat, lng, deviceCode]);
  }

  // Save reading + fire logic (you can expand this later)
  io?.emit('sensor:reading', { deviceCode, smoke_ppm, temperature_c, ...data });
}

function handleStatus(deviceCode, payload, io) {
  try {
    const data = JSON.parse(payload);
    db().run(`UPDATE devices SET status = ?, last_seen = datetime('now') WHERE device_code = ?`, 
      [data.status || 'online', deviceCode]);
  } catch (_) {}
}

function handleGPS(deviceCode, payload, io) {
  try {
    const { lat, lng } = JSON.parse(payload);
    db().run(`UPDATE devices SET gps_lat = ?, gps_lng = ? WHERE device_code = ?`, [lat, lng, deviceCode]);
  } catch (_) {}
}

// =============================================================
// CONNECT TO HIVEMQ CLOUD (Clean Version)
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

  if (!host || !username || !password) {
    log().error('[MQTT] ❌ Missing MQTT credentials in .env');
    return null;
  }

  const brokerUrl = `tls://${host}:${port}`;
  log().info(`[MQTT] Attempting connection → ${brokerUrl}`);

  const options = {
    clientId: `sfdaass-backend-${Date.now()}`,
    username,
    password,
    rejectUnauthorized: false,
    reconnectPeriod: 10000,
    connectTimeout: 60000,
    keepalive: 60,
    clean: true,
  };

  client = mqtt.connect(brokerUrl, options);

  client.on('connect', () => {
    log().info('🎉 ✅ SUCCESSFULLY CONNECTED TO HIVEMQ CLOUD!');

    const topics = ['sfdaass/sensors/#', 'sfdaass/alert/#', 'sfdaass/status/#', 'sfdaass/gps/#'];
    topics.forEach(t => {
      client.subscribe(t, { qos: 1 }, (err) => {
        if (err) log().error(`Subscribe failed: ${t}`);
        else log().info(`[MQTT] Subscribed → ${t}`);
      });
    });
  });

  client.on('error', (err) => {
    log().error(`[MQTT] Error: ${err.message}`);
    log().error(`[MQTT] Code: ${err.code || 'N/A'}`);
  });

  client.on('reconnect', () => log().warn('[MQTT] 🔄 Reconnecting...'));
  client.on('offline', () => log().warn('[MQTT] 📴 Offline'));
  client.on('close', () => log().warn('[MQTT] Connection closed'));

  client.on('message', (topic, message) => {
    const payload = message.toString();
    const parts = topic.split('/');
    if (parts.length < 3) return;

    const category = parts[1];
    const deviceCode = parts[2];

    if (category === 'sensors' || category === 'alert') handleSensorData(deviceCode, payload, io);
    else if (category === 'status') handleStatus(deviceCode, payload, io);
    else if (category === 'gps') handleGPS(deviceCode, payload, io);
  });

  return client;
}

function getClient() { return client; }

module.exports = { connectMQTT, getClient };