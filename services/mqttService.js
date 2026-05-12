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