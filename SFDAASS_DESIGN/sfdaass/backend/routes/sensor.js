/**
 * /api/sensor — IoT device data ingestion (HTTP)
 * Devices POST sensor readings here; this endpoint runs the
 * full fire-detection pipeline and emits Socket.IO events.
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { query, queryOne, withTransaction } = require('../database/db');
const { authenticateDevice } = require('../middleware/auth');
const { authenticate, authorize } = require('../middleware/auth');
const { checkGeofence } = require('../utils/geofence');
const { evaluateReading, startConfirmation, cancelConfirmation, shouldActivateSuppression } = require('../utils/fireEngine');
const { sendFireAlert } = require('../utils/notifications');
const logger = require('../utils/logger');

let _io = null; // injected by server.js

const setIO = (io) => { _io = io; };

const emit = (event, data) => {
  if (_io) _io.emit(event, data);
};

// ── POST /api/sensor/reading ─────────────────────────────────────
// IoT device posts a sensor reading
router.post('/reading', authenticateDevice, [
  body('smoke_ppm').optional().isFloat({ min: 0, max: 10000 }),
  body('temperature_c').optional().isFloat({ min: -50, max: 1000 }),
  body('gas_ppm').optional().isFloat({ min: 0, max: 10000 }),
  body('humidity_pct').optional().isFloat({ min: 0, max: 100 }),
  body('flame_detected').optional().isBoolean(),
  body('gps_lat').optional().isFloat({ min: -90, max: 90 }),
  body('gps_lng').optional().isFloat({ min: -180, max: 180 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const device = req.device;
    const {
      smoke_ppm, temperature_c, gas_ppm, humidity_pct = null,
      flame_detected = false,
      gps_lat, gps_lng, gps_accuracy_m,
      rssi, battery_pct, uptime_seconds,
    } = req.body;

    // Geofence check
    let insideGeofence = null;
    let geofence = null;
    if (gps_lat != null && gps_lng != null && device.geofence_id) {
      geofence = await queryOne(
        'SELECT type, center_lat, center_lng, radius_meters, polygon_coords FROM geofences WHERE id=$1 AND is_active=TRUE',
        [device.geofence_id]
      );
      if (geofence) {
        const result = checkGeofence(gps_lat, gps_lng, geofence);
        insideGeofence = result.inside;
      }
    }

    // Store reading
    const readingRow = await queryOne(
      `INSERT INTO sensor_readings
         (device_id, smoke_ppm, temperature_c, gas_ppm, humidity_pct, flame_detected,
          gps_lat, gps_lng, gps_accuracy_m, inside_geofence, rssi, battery_pct, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, recorded_at`,
      [device.id, smoke_ppm, temperature_c, gas_ppm, humidity_pct, flame_detected,
       gps_lat, gps_lng, gps_accuracy_m, insideGeofence, rssi, battery_pct,
       JSON.stringify(req.body)]
    );

    // Update device telemetry (upsert)
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

    // Emit live telemetry to dashboard
    emit('sensor:reading', {
      deviceId: device.id,
      deviceCode: device.device_code,
      locationLabel: device.location_label,
      smoke_ppm, temperature_c, gas_ppm, humidity_pct, flame_detected,
      gps_lat, gps_lng, insideGeofence,
      battery_pct, rssi,
      timestamp: readingRow.recorded_at,
    });

    // ── Fire detection pipeline ──────────────────────────────────
    const reading = { smoke_ppm, temperature_c, gas_ppm, flame_detected };
    const evaluation = evaluateReading(reading);

    if (evaluation.level === 'normal') {
      // Cancel any pending confirmation
      cancelConfirmation(device.id);
    } else {
      // Check for existing active incident on this device
      const existingIncident = await queryOne(
        `SELECT id FROM incidents WHERE device_id=$1 AND status IN ('active','monitoring')
         ORDER BY detected_at DESC LIMIT 1`,
        [device.id]
      );

      if (!existingIncident) {
        startConfirmation(device.id, reading, evaluation, {
          onConfirmed: async (deviceId, severity, latestReading, latestEval) => {
            await createIncident(device, severity, latestReading, gps_lat, gps_lng, insideGeofence);
          },
          onCancelled: (deviceId) => {
            emit('sensor:normal', { deviceId, deviceCode: device.device_code });
          }
        });
      } else {
        // Existing incident — just update dashboard
        emit('incident:update', { incidentId: existingIncident.id, evaluation });
      }
    }

    res.json({ success: true, readingId: readingRow.id, evaluation: { level: evaluation.level } });
  } catch (err) {
    logger.error('Sensor reading error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to process reading' });
  }
});

// ── Create incident in DB + notify + suppress ────────────────────
async function createIncident(device, severity, reading, gps_lat, gps_lng, insideGeofence) {
  try {
    const incident = await withTransaction(async (client) => {
      // Create incident
      const inc = await client.query(
        `INSERT INTO incidents
           (device_id, severity, status, detected_at, gps_lat, gps_lng, inside_geofence,
            smoke_ppm, temperature_c, gas_ppm, flame_detected)
         VALUES ($1,$2,'active',NOW(),$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [device.id, severity, gps_lat, gps_lng, insideGeofence,
         reading.smoke_ppm, reading.temperature_c, reading.gas_ppm, reading.flame_detected]
      );
      const incident = inc.rows[0];

      // Timeline event
      await client.query(
        `INSERT INTO incident_events (incident_id, event_type, description, actor)
         VALUES ($1,'detected',$2,'system')`,
        [incident.id, `Fire detected: smoke=${reading.smoke_ppm}ppm temp=${reading.temperature_c}°C`]
      );

      // Activate suppression?
      if (shouldActivateSuppression(severity, insideGeofence)) {
        await client.query('UPDATE incidents SET sprinkler_activated=TRUE, sprinkler_on_at=NOW(), suppression_trigger=\'automatic\' WHERE id=$1', [incident.id]);
        await client.query(
          `INSERT INTO incident_events (incident_id, event_type, description, actor)
           VALUES ($1,'sprinkler_activated','Automatic suppression activated','system')`,
          [incident.id]
        );
        // Activate zone(s)
        await client.query(`UPDATE sprinkler_zones SET status='active', last_activated=NOW(), activated_by='system' WHERE zone_code='ZONE-A'`);
        incident.sprinkler_activated = true;
      }

      return incident;
    });

    // Emit to dashboard
    emit('incident:created', {
      id: incident.id,
      incident_code: incident.incident_code,
      severity: incident.severity,
      deviceCode: device.device_code,
      locationLabel: device.location_label,
      smoke_ppm: reading.smoke_ppm,
      temperature_c: reading.temperature_c,
      gps_lat, gps_lng, insideGeofence,
      sprinkler_activated: incident.sprinkler_activated,
      detected_at: incident.detected_at,
    });

    // Send alerts
    await sendFireAlert(incident, device);

    logger.warn(`🔥 INCIDENT CREATED: ${incident.incident_code} | ${device.device_code} | ${severity}`);
    return incident;
  } catch (err) {
    logger.error('Create incident error:', err.message);
  }
}

// ── GET /api/sensor/latest/:deviceCode ──────────────────────────
// Dashboard polling fallback
router.get('/latest/:deviceCode', authenticate, async (req, res) => {
  try {
    const device = await queryOne('SELECT id FROM devices WHERE device_code=$1', [req.params.deviceCode]);
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

    const reading = await queryOne(
      `SELECT * FROM sensor_readings WHERE device_id=$1 ORDER BY recorded_at DESC LIMIT 1`,
      [device.id]
    );
    res.json({ success: true, reading });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── GET /api/sensor/history/:deviceCode ─────────────────────────
router.get('/history/:deviceCode', authenticate, async (req, res) => {
  try {
    const { hours = 24, limit = 200 } = req.query;
    const device = await queryOne('SELECT id FROM devices WHERE device_code=$1', [req.params.deviceCode]);
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

    const rows = await queryOne(
      `SELECT recorded_at, smoke_ppm, temperature_c, gas_ppm, humidity_pct, flame_detected,
              gps_lat, gps_lng, inside_geofence, battery_pct, rssi
       FROM sensor_readings
       WHERE device_id=$1 AND recorded_at >= NOW() - INTERVAL '${parseInt(hours)} hours'
       ORDER BY recorded_at ASC
       LIMIT $2`,
      [device.id, parseInt(limit)]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
module.exports.setIO = setIO;
