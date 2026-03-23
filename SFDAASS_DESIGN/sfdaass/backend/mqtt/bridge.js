/**
 * MQTT Bridge
 * Connects to MQTT broker, subscribes to device topics,
 * and processes incoming sensor data through the same pipeline
 * as the HTTP endpoint.
 *
 * Topic format: sfdaass/devices/{device_code}/telemetry
 * Device → Broker: JSON payload with sensor readings
 * Server → Device: sfdaass/devices/{device_code}/command
 */

const mqtt = require('mqtt');
const logger = require('../utils/logger');
const { queryOne, query } = require('../database/db');
const { checkGeofence } = require('../utils/geofence');
const { evaluateReading, startConfirmation, cancelConfirmation, shouldActivateSuppression } = require('../utils/fireEngine');
const { sendFireAlert } = require('../utils/notifications');

let client = null;
let _io = null;

const TOPIC_TELEMETRY = 'sfdaass/devices/+/telemetry';
const TOPIC_STATUS    = 'sfdaass/devices/+/status';

const emit = (event, data) => { if (_io) _io.emit(event, data); };

/**
 * Connect to MQTT broker and start listening
 */
function connect(io) {
  _io = io;

  const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';

  const options = {
    clientId: `sfdaass_server_${Date.now()}`,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  };

  if (process.env.MQTT_USERNAME) {
    options.username = process.env.MQTT_USERNAME;
    options.password = process.env.MQTT_PASSWORD;
  }

  logger.info(`Connecting to MQTT broker: ${brokerUrl}`);

  try {
    client = mqtt.connect(brokerUrl, options);
  } catch (err) {
    logger.warn(`MQTT broker not available: ${err.message}. Running in HTTP-only mode.`);
    return null;
  }

  client.on('connect', () => {
    logger.info('✅ MQTT broker connected');
    client.subscribe([TOPIC_TELEMETRY, TOPIC_STATUS], { qos: 1 }, (err) => {
      if (err) logger.error('MQTT subscribe error:', err.message);
      else logger.info(`MQTT subscribed: ${TOPIC_TELEMETRY}, ${TOPIC_STATUS}`);
    });
  });

  client.on('message', async (topic, payload) => {
    try {
      const parts = topic.split('/');
      const deviceCode = parts[2];
      const messageType = parts[3];

      let data;
      try { data = JSON.parse(payload.toString()); }
      catch { logger.warn(`Invalid JSON from ${deviceCode}`); return; }

      if (messageType === 'telemetry') {
        await processTelemetry(deviceCode, data);
      } else if (messageType === 'status') {
        await processStatus(deviceCode, data);
      }
    } catch (err) {
      logger.error('MQTT message processing error:', err.message);
    }
  });

  client.on('error', (err) => {
    logger.warn(`MQTT error: ${err.message}`);
  });

  client.on('offline', () => {
    logger.warn('MQTT client offline — reconnecting...');
  });

  client.on('reconnect', () => {
    logger.info('MQTT reconnecting...');
  });

  return client;
}

/**
 * Process telemetry payload from device
 * Expected payload:
 * {
 *   smoke_ppm: 350, temperature_c: 45.2, gas_ppm: 120,
 *   humidity_pct: 42, flame_detected: false,
 *   gps_lat: -13.9626, gps_lng: 33.7741, gps_accuracy_m: 5,
 *   battery_pct: 87, rssi: -62, uptime_seconds: 3600
 * }
 */
async function processTelemetry(deviceCode, data) {
  const device = await queryOne(
    'SELECT id, device_code, location_label, geofence_id, is_active FROM devices WHERE device_code=$1',
    [deviceCode]
  );

  if (!device || !device.is_active) {
    logger.warn(`MQTT: Unknown or inactive device: ${deviceCode}`);
    return;
  }

  const {
    smoke_ppm, temperature_c, gas_ppm, humidity_pct,
    flame_detected = false,
    gps_lat, gps_lng, gps_accuracy_m,
    battery_pct, rssi, uptime_seconds,
  } = data;

  // Geofence
  let insideGeofence = null;
  if (gps_lat != null && gps_lng != null && device.geofence_id) {
    const geofence = await queryOne(
      'SELECT type, center_lat, center_lng, radius_meters, polygon_coords FROM geofences WHERE id=$1 AND is_active=TRUE',
      [device.geofence_id]
    );
    if (geofence) {
      insideGeofence = checkGeofence(gps_lat, gps_lng, geofence).inside;
    }
  }

  // Store reading
  const readingRow = await queryOne(
    `INSERT INTO sensor_readings
       (device_id, smoke_ppm, temperature_c, gas_ppm, humidity_pct, flame_detected,
        gps_lat, gps_lng, gps_accuracy_m, inside_geofence, rssi, battery_pct, raw_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, recorded_at`,
    [device.id, smoke_ppm, temperature_c, gas_ppm, humidity_pct, flame_detected,
     gps_lat, gps_lng, gps_accuracy_m, insideGeofence, rssi, battery_pct, JSON.stringify(data)]
  );

  // Upsert telemetry
  await query(
    `INSERT INTO device_telemetry
       (device_id, status, last_seen, last_reading_id, smoke_ppm, temperature_c,
        gas_ppm, humidity_pct, flame_detected, gps_lat, gps_lng, inside_geofence,
        battery_pct, rssi, uptime_seconds)
     VALUES ($1,'online',NOW(),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (device_id) DO UPDATE SET
       status='online', last_seen=NOW(), last_reading_id=$2,
       smoke_ppm=$3, temperature_c=$4, gas_ppm=$5, humidity_pct=$6,
       flame_detected=$7, gps_lat=$8, gps_lng=$9, inside_geofence=$10,
       battery_pct=$11, rssi=$12, uptime_seconds=$13, updated_at=NOW()`,
    [device.id, readingRow.id, smoke_ppm, temperature_c, gas_ppm, humidity_pct,
     flame_detected, gps_lat, gps_lng, insideGeofence, battery_pct, rssi, uptime_seconds]
  );

  // Emit to dashboard
  emit('sensor:reading', {
    deviceId: device.id, deviceCode: device.device_code,
    locationLabel: device.location_label,
    smoke_ppm, temperature_c, gas_ppm, humidity_pct, flame_detected,
    gps_lat, gps_lng, insideGeofence, battery_pct, rssi,
    timestamp: readingRow.recorded_at,
  });

  // Fire detection
  const evaluation = evaluateReading({ smoke_ppm, temperature_c, gas_ppm, flame_detected });

  if (evaluation.level === 'normal') {
    cancelConfirmation(device.id);
  } else {
    const existing = await queryOne(
      `SELECT id FROM incidents WHERE device_id=$1 AND status IN ('active','monitoring') LIMIT 1`,
      [device.id]
    );

    if (!existing) {
      startConfirmation(device.id, { smoke_ppm, temperature_c, gas_ppm, flame_detected }, evaluation, {
        onConfirmed: async (deviceId, severity, reading) => {
          await createIncidentFromMQTT(device, severity, reading, gps_lat, gps_lng, insideGeofence);
        },
      });
    }
  }

  logger.debug(`MQTT telemetry: ${deviceCode} | smoke=${smoke_ppm} temp=${temperature_c} eval=${evaluation.level}`);
}

async function processStatus(deviceCode, data) {
  const device = await queryOne('SELECT id FROM devices WHERE device_code=$1', [deviceCode]);
  if (!device) return;

  const status = data.online ? 'online' : 'offline';
  await query(
    `UPDATE device_telemetry SET status=$1, last_seen=NOW() WHERE device_id=$2`,
    [status, device.id]
  );
  emit('device:status', { deviceCode, status, timestamp: new Date().toISOString() });
}

async function createIncidentFromMQTT(device, severity, reading, gps_lat, gps_lng, insideGeofence) {
  try {
    const inc = await queryOne(
      `INSERT INTO incidents
         (device_id, severity, status, detected_at, gps_lat, gps_lng, inside_geofence,
          smoke_ppm, temperature_c, gas_ppm, flame_detected,
          sprinkler_activated, suppression_trigger,
          sprinkler_on_at)
       VALUES ($1,$2,'active',NOW(),$3,$4,$5,$6,$7,$8,$9,$10,$11,
               CASE WHEN $10 THEN NOW() ELSE NULL END)
       RETURNING *`,
      [device.id, severity, gps_lat, gps_lng, insideGeofence,
       reading.smoke_ppm, reading.temperature_c, reading.gas_ppm, reading.flame_detected,
       shouldActivateSuppression(severity, insideGeofence),
       shouldActivateSuppression(severity, insideGeofence) ? 'automatic' : null]
    );

    await query(
      `INSERT INTO incident_events (incident_id, event_type, description, actor)
       VALUES ($1,'detected',$2,'system')`,
      [inc.id, `MQTT: Fire detected smoke=${reading.smoke_ppm} temp=${reading.temperature_c}`]
    );

    emit('incident:created', {
      id: inc.id, incident_code: inc.incident_code, severity,
      deviceCode: device.device_code, locationLabel: device.location_label,
      smoke_ppm: reading.smoke_ppm, temperature_c: reading.temperature_c,
      gps_lat, gps_lng, insideGeofence, sprinkler_activated: inc.sprinkler_activated,
      detected_at: inc.detected_at,
    });

    await sendFireAlert(inc, device);
    logger.warn(`🔥 MQTT INCIDENT: ${inc.incident_code} | ${device.device_code} | ${severity}`);
  } catch (err) {
    logger.error('MQTT create incident error:', err.message);
  }
}

/**
 * Send command to a device via MQTT
 * command: { action: 'activate_sprinkler' | 'deactivate_sprinkler' | 'reboot' | 'config_update', ... }
 */
function sendCommand(deviceCode, command) {
  if (!client || !client.connected) {
    logger.warn(`Cannot send MQTT command to ${deviceCode}: not connected`);
    return false;
  }
  const topic = `sfdaass/devices/${deviceCode}/command`;
  client.publish(topic, JSON.stringify({ ...command, timestamp: new Date().toISOString() }), { qos: 1 });
  logger.info(`MQTT command sent to ${deviceCode}: ${command.action}`);
  return true;
}

function disconnect() {
  if (client) { client.end(); client = null; }
}

module.exports = { connect, sendCommand, disconnect };
