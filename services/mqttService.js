// services/mqttService.js
// PostGIS edition — Fixed for PostgreSQL migration + robust error handling

require('dotenv').config();
const mqtt = require('mqtt');
const { v4: uuidv4 } = require('uuid');

var _db, _notify, _logger;

function db() {
  if (!_db) _db = require('../db/database');
  return _db;
}

function log() {
  if (!_logger) {
    try {
      _logger = require('./logger');
    } catch (e) {
      _logger = {
        info: (m) => console.log('[INFO]', m),
        warn: (m) => console.warn('[WARN]', m),
        error: (m) => console.error('[ERROR]', m)
      };
    }
  }
  return _logger;
}

function notify() {
  if (!_notify) {
    try {
      _notify = require('./notifyService');
    } catch (e) {
      _notify = {
        sendSMS: () => Promise.resolve(false),
        sendEmail: () => Promise.resolve(false)
      };
    }
  }
  return _notify;
}

var client = null;

// =============================================================
// PostGIS geofence check
// =============================================================
async function checkGeofencePostGIS(lat, lng) {
  if (lat == null || lng == null) return null;

  var geo = await db().get(
    'SELECT id FROM geofences WHERE is_active = 1 AND geom IS NOT NULL LIMIT 1'
  );
  if (!geo) return null;

  var result = await db().get(
    'SELECT ST_Within(ST_SetSRID(ST_MakePoint($1, $2), 4326), geom) AS inside FROM geofences WHERE id = $3',
    [lng, lat, geo.id]
  );

  if (!result) return null;
  return result.inside;
}

// Returns distance in metres from device to geofence centre
async function getDistanceToGeofence(lat, lng) {
  if (lat == null || lng == null) return null;

  var result = await db().get(
    [
      'SELECT ROUND(',
      '  ST_Distance(',
      '    ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,',
      '    ST_Centroid(geom)::geography',
      '  )',
      ') AS distance_m',
      'FROM geofences WHERE is_active = 1 AND geom IS NOT NULL LIMIT 1'
    ].join(' '),
    [lng, lat]
  );

  return result ? result.distance_m : null;
}

// Find other active incidents within radiusMetres
async function getNearbyIncidents(lat, lng, radiusMetres) {
  if (lat == null || lng == null) return [];
  var r = radiusMetres || 200;

  return db().all(
    [
      'SELECT id, incident_code, severity,',
      '  ROUND(ST_Distance(location::geography,',
      '    ST_SetSRID(ST_MakePoint($1,$2),4326)::geography',
      '  )) AS distance_m',
      'FROM incidents',
      'WHERE location IS NOT NULL',
      '  AND status != \'resolved\'',
      '  AND ST_DWithin(',
      '    location::geography,',
      '    ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,',
      '    $3',
      '  )',
      'ORDER BY distance_m ASC'
    ].join(' '),
    [lng, lat, r]
  );
}

// =============================================================
// Read thresholds
// =============================================================
async function getThresholds() {
  var rows = await db().all('SELECT key, value FROM system_config');
  var t = {};
  rows.forEach(function(r) { t[r.key] = parseFloat(r.value); });
  return {
    smoke_warning:  t.smoke_warning  != null ? t.smoke_warning  : 250,
    smoke_critical: t.smoke_critical != null ? t.smoke_critical : 500,
    temp_warning:   t.temp_warning   != null ? t.temp_warning   : 50,
    temp_critical:  t.temp_critical  != null ? t.temp_critical  : 100,
    gas_warning:    t.gas_warning    != null ? t.gas_warning    : 150,
    gas_critical:   t.gas_critical   != null ? t.gas_critical   : 300,
  };
}

function getSeverity(smoke, temp, gas, flame, t) {
  if (flame || smoke >= t.smoke_critical || temp >= t.temp_critical || gas >= t.gas_critical) {
    return 'critical';
  }
  if (smoke >= t.smoke_warning || temp >= t.temp_warning || gas >= t.gas_warning) {
    return 'warning';
  }
  return 'low';
}

// =============================================================
// FIXED: Handle sensor data with full error protection
// =============================================================
async function handleSensorData(deviceCode, payload, io) {
  try {
    var data;
    try {
      data = JSON.parse(payload);
     
    } catch (e) {
      log().warn('[MQTT] Invalid JSON from ' + deviceCode);
      return;
    } 


    var smoke_ppm      = data.smoke;
    var temperature_c  = data.temp;
    var gas_ppm        = data.gas;
    var humidity_pct   = data.humidity;
    var battery_pct    = data.battery;
    var flame_detected = data.flame;
    var lat            = data.lat;
    var lng            = data.lon;

    // 1. Upsert device record
    var device = await db().get('SELECT * FROM devices WHERE device_code = $1', [deviceCode]);

    if (!device) {
        await db().query(
        [
          'INSERT INTO devices',
          '  (device_code, name, location_label, status,',
          '   gps_lat, gps_lng, location,',
          '   smoke_ppm, temperature_c, gas_ppm, humidity_pct,',
          '   battery_pct, flame_detected, last_seen, seconds_since_seen, api_key)',
          'VALUES ($1,$2,$3,$4,',
          '  $5,$6,',
          '  CASE WHEN $5::double precision IS NOT NULL AND $6::double precision IS NOT NULL',
          '       THEN ST_SetSRID(ST_MakePoint($6::double precision,$5::double precision),4326) ELSE NULL END,',
          '  $7,$8,$9,$10,$11,$12,NOW(),0,$13)'
        ].join(' '),
        [deviceCode, 'Device ' + deviceCode, '', 'online',
         lat != null ? lat : null,
         lng != null ? lng : null,
         smoke_ppm != null ? smoke_ppm : null,
         temperature_c != null ? temperature_c : null,
         gas_ppm != null ? gas_ppm : null,
         humidity_pct != null ? humidity_pct : null,
         battery_pct != null ? battery_pct : null,
         flame_detected ? 1 : 0,
         uuidv4()]
      );
      log().info('[MQTT] Auto-registered device: ' + deviceCode);
    } else {
      await db().query(
        [
          'UPDATE devices SET',
          '  status = $1,',
          '  gps_lat = COALESCE($2, gps_lat),',
          '  gps_lng = COALESCE($3, gps_lng),',
          '  location = CASE',
          '    WHEN $2::double precision IS NOT NULL AND $3::double precision IS NOT NULL',
          '    THEN ST_SetSRID(ST_MakePoint($3::double precision,$2::double precision),4326)',
          '    ELSE location END,',
          '  smoke_ppm     = COALESCE($4, smoke_ppm),',
          '  temperature_c = COALESCE($5, temperature_c),',
          '  gas_ppm       = COALESCE($6, gas_ppm),',
          '  humidity_pct  = COALESCE($7, humidity_pct),',
          '  battery_pct   = COALESCE($8, battery_pct),',
          '  flame_detected = COALESCE($9, flame_detected),',
          '  last_seen = NOW(),',
          '  seconds_since_seen = 0',
          'WHERE device_code = $10'
        ].join(' '),
        ['online',
         lat != null ? lat : null,
         lng != null ? lng : null,
         smoke_ppm != null ? smoke_ppm : null,
         temperature_c != null ? temperature_c : null,
         gas_ppm != null ? gas_ppm : null,
         humidity_pct != null ? humidity_pct : null,
         battery_pct != null ? battery_pct : null,
         flame_detected ? 1 : 0,
         deviceCode]
      );
    }

    device = await db().get('SELECT * FROM devices WHERE device_code = $1', [deviceCode]);

    // 2. Save time-series reading
     const insertNewReading = await db().query(
      [
        'INSERT INTO sensor_readings',
        '  (device_id, device_code, smoke_ppm, temperature_c,',
        '   gas_ppm, humidity_pct, battery_pct, flame_detected,',
        '   gps_lat, gps_lng, location)',
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,',
        '  CASE WHEN $9::double precision IS NOT NULL AND $10::double precision IS NOT NULL',
        '       THEN ST_SetSRID(ST_MakePoint($10::double precision,$9::double precision),4326) ELSE NULL END)'
      ].join(' '),
      [device.id, deviceCode,
       smoke_ppm != null ? smoke_ppm : null,
       temperature_c != null ? temperature_c : null,
       gas_ppm != null ? gas_ppm : null,
       humidity_pct != null ? humidity_pct : null,
       battery_pct != null ? battery_pct : null,
       flame_detected ? 1 : 0,
       lat != null ? lat : device.gps_lat,
       lng != null ? lng : device.gps_lng]
    );

    if (!insertNewReading) {
      log().error('[MQTT] Failed to insert sensor reading for ' + deviceCode);
    }   
    else {
      log().info('[MQTT] Sensor reading saved for ' + deviceCode);
    }

    // 3. Push live update to dashboard ← This is the key line for live readings
    if (io) {
      io.emit('sensor:reading', {
        deviceCode: deviceCode,
        smoke_ppm: smoke_ppm,
        temperature_c: temperature_c,
        gas_ppm: gas_ppm,
        humidity_pct: humidity_pct,
        battery_pct: battery_pct,
        flame_detected: flame_detected,
        gps_lat: lat != null ? lat : device.gps_lat,
        gps_lng: lng != null ? lng : device.gps_lng,
        ts: new Date().toISOString(),
      });
    }

    // 4. Fire detection
    var t = await getThresholds();
    var isFire = flame_detected
      || (smoke_ppm     != null && smoke_ppm     >= t.smoke_warning)
      || (temperature_c != null && temperature_c >= t.temp_warning)
      || (gas_ppm       != null && gas_ppm       >= t.gas_warning);

    if (!isFire) return;

    // ... rest of the function remains the same (existing incident logic) ...

    var existing = await db().get(
      'SELECT id FROM incidents WHERE device_code = $1 AND status IN ($2,$3,$4)',
      [deviceCode, 'active', 'monitoring', 'acknowledged']
    );
    if (existing) return;

    var effectiveLat = lat != null ? lat : device.gps_lat;
    var effectiveLng = lng != null ? lng : device.gps_lng;
    var insideGeo    = await checkGeofencePostGIS(effectiveLat, effectiveLng);
    var distanceM    = await getDistanceToGeofence(effectiveLat, effectiveLng);
    var nearby       = await getNearbyIncidents(effectiveLat, effectiveLng, 200);

    log().info(
      '[PostGIS] ' + deviceCode +
      ' inside=' + insideGeo +
      ' dist=' + distanceM + 'm' +
      ' nearby=' + nearby.length
    );

    var severity = getSeverity(smoke_ppm, temperature_c, gas_ppm, flame_detected, t);
    var incCode  = 'INC-' + new Date().getFullYear() + '-' +
                   uuidv4().replace(/-/g, '').slice(0, 6).toUpperCase();

    var result = await db().query(
      [
        'INSERT INTO incidents',
        '  (incident_code, device_id, device_code, location_label,',
        '   severity, status, smoke_ppm, temperature_c,',
        '   gas_ppm, humidity_pct, flame_detected,',
        '   gps_lat, gps_lng, location, inside_geofence)',
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,',
        '  CASE WHEN $12::double precision IS NOT NULL AND $13::double precision IS NOT NULL',
        '       THEN ST_SetSRID(ST_MakePoint($13::double precision,$12::double precision),4326) ELSE NULL END,',
        '  $14)',
        'RETURNING id'
      ].join(' '),
      [incCode, device.id, deviceCode, device.location_label || '',
       severity, 'active',
       smoke_ppm != null ? smoke_ppm : null,
       temperature_c != null ? temperature_c : null,
       gas_ppm != null ? gas_ppm : null,
       humidity_pct != null ? humidity_pct : null,
       flame_detected ? 1 : 0,
       effectiveLat, effectiveLng,
       insideGeo === null ? null : (insideGeo ? 1 : 0)]
    );

    var incidentId = result.rows[0].id;

    await db().query(
      'INSERT INTO incident_events (incident_id, event_type, description) VALUES ($1,$2,$3)',
      [incidentId, 'detected',
       'Smoke:' + smoke_ppm + 'ppm Temp:' + temperature_c + 'C Flame:' + flame_detected +
       ' | PostGIS inside:' + insideGeo + ' dist:' + distanceM + 'm']
    );

    if (severity === 'critical') {
      if (client) {
        client.publish(
          'sfdaass/sprinkler/' + deviceCode,
          JSON.stringify({ activate: true, incident: incCode }),
          { qos: 1 }
        );
      }
      await db().query('UPDATE incidents SET sprinkler_activated = 1 WHERE id = $1', [incidentId]);
      await db().query(
        'INSERT INTO incident_events (incident_id, event_type, description) VALUES ($1,$2,$3)',
        [incidentId, 'sprinkler_activated', 'Auto sprinkler activation triggered']
      );
      log().warn('[MQTT] Sprinkler command sent to ' + deviceCode);
    }

    var incident = await db().get('SELECT * FROM incidents WHERE id = $1', [incidentId]);
    if (io) {
      io.emit('incident:created', Object.assign({}, incident, {
        nearby_count: nearby.length,
        distance_to_fence_m: distanceM,
      }));
    }
    log().warn('[MQTT] FIRE ' + incCode + ' | ' + deviceCode + ' | ' + severity);

    // 9. Notifications (safe)
    var msg = [
      'FIRE ALERT [' + severity.toUpperCase() + ']',
      'Device   : ' + deviceCode + ' - ' + (device.location_label || 'Unknown'),
      'Smoke    : ' + smoke_ppm + ' ppm',
      'Temp     : ' + temperature_c + 'C',
      'Flame    : ' + (flame_detected ? 'YES' : 'NO'),
      'GPS      : ' + effectiveLat + ', ' + effectiveLng,
      'Geofence : ' + (insideGeo === null ? 'N/A' : insideGeo ? 'Inside' : 'OUTSIDE'),
      'Distance : ' + (distanceM != null ? distanceM + 'm from fence centre' : 'N/A'),
      'Nearby   : ' + nearby.length + ' other incident(s) within 200m',
      'Incident : ' + incCode,
    ].join('\n');

    notify().sendSMS(msg).catch(() => {});
    notify().sendEmail({
      subject: '[SFDAASS] ' + incCode + ' - ' + severity.toUpperCase() + ' Fire Alert',
      text: msg,
      html: '<div style="background:#ff4e1a;color:white;padding:16px;border-radius:8px">' +
            '<h2>FIRE ALERT - ' + severity.toUpperCase() + '</h2></div>' +
            '<pre style="padding:12px;background:#fff3f3;border:1px solid #ffcccc">' + msg + '</pre>',
    }).catch(() => {});

  } catch (err) {
    log().error(`[MQTT] Critical error handling sensor data from ${deviceCode}: ${err.message}`);
    console.error(err);
  }
}

// Keep the rest of the file unchanged (handleStatus, handleGPS, connectMQTT, etc.)
async function handleStatus(deviceCode, payload, io) {
  try {
    var data = JSON.parse(payload);
    await db().query(
      'UPDATE devices SET status = $1, last_seen = NOW(), seconds_since_seen = 0 WHERE device_code = $2',
      [data.status || 'online', deviceCode]
    );
    if (io) io.emit('device:status', { deviceCode: deviceCode, status: data.status || 'online' });
  } catch (e) {}
}

async function handleGPS(deviceCode, payload, io) {
  try {
    var data = JSON.parse(payload);
    var lat = data.lat;
    var lng = data.lng;
    await db().query(
      [
        'UPDATE devices SET',
        '  gps_lat  = $1,',
        '  gps_lng  = $2,',
        '  location = ST_SetSRID(ST_MakePoint($2::double precision,$1::double precision), 4326)',
        'WHERE device_code = $3'
      ].join(' '),
      [lat, lng, deviceCode]
    );
    if (io) io.emit('gps:update', { deviceCode: deviceCode, lat: lat, lng: lng });
  } catch (e) {}
}

// =============================================================
// Connect to HiveMQ Cloud
// =============================================================
function connectMQTT(io) {
  var host     = (process.env.MQTT_HOST     || '').trim();
  var port     = parseInt(process.env.MQTT_PORT) || 8883;
  var username = (process.env.MQTT_USERNAME || '').trim();
  var password = (process.env.MQTT_PASSWORD || '').trim();

  if (!host || !username || !password) {
    log().error('[MQTT] Missing MQTT credentials in .env');
    return null;
  }

  var brokerUrl = 'tls://' + host + ':' + port;
  log().info('[MQTT] Connecting to HiveMQ: ' + brokerUrl);

  client = mqtt.connect(brokerUrl, {
    clientId:           'sfdaass-backend-' + Date.now(),
    username:           username,
    password:           password,
    rejectUnauthorized: false,
    reconnectPeriod:    5000,
    connectTimeout:     30000,
    keepalive:          60,
    clean:              true,
    reschedulePings: true,
  });

  client.on('connect', function() {
    log().info('[MQTT] Connected to HiveMQ Cloud');
    var topics = [
      'sfdaass/sensors/#',
      'sfdaass/alert/#',
      'sfdaass/status/#',
      'sfdaass/gps/#',
    ];
    topics.forEach(function(t) {
      client.subscribe(t, { qos: 1 }, function(err) {
        if (err) log().error('[MQTT] Subscribe failed: ' + t);
        else     log().info('[MQTT] Subscribed: ' + t);
      });
    });
  });

  client.on('error',     function(err) { log().error('[MQTT] Error: ' + err.message); });
  client.on('reconnect', function()    { log().warn('[MQTT] Reconnecting...'); });
  client.on('offline',   function()    { log().warn('[MQTT] Offline'); });
  client.on('close',     function()    { log().warn('[MQTT] Connection closed'); });

  client.on('message', function(topic, message) {
    var payload  = message.toString();
    var parts    = topic.split('/');
    if (parts.length < 3) return;
    var category   = parts[1];
    var deviceCode = parts[2];

    if (category === 'sensors' || category === 'alert') {
      handleSensorData(deviceCode, payload, io);
    } else if (category === 'status') {
      handleStatus(deviceCode, payload, io);
    } else if (category === 'gps') {
      handleGPS(deviceCode, payload, io);
    }
  });

  setInterval(async function() {
    try {
      await db().query(
        [
          'UPDATE devices SET',
          '  status = $1,',
          '  seconds_since_seen = EXTRACT(EPOCH FROM (NOW() - last_seen))::INTEGER',
          'WHERE last_seen < NOW() - INTERVAL \'120 seconds\'',
          '  AND status != $1'
        ].join(' '),
        ['offline']
      );
      await db().query(
        [
          'UPDATE devices SET',
          '  seconds_since_seen = EXTRACT(EPOCH FROM (NOW() - last_seen))::INTEGER',
          'WHERE last_seen IS NOT NULL'
        ].join(' ')
      );
      if (io) io.emit('system:heartbeat', { ts: new Date().toISOString() });
    } catch (e) {}
  }, 30000);

  return client;
}

function getClient() {
  return client;
}

module.exports = {
  connectMQTT: connectMQTT,
  getClient: getClient,
  checkGeofencePostGIS: checkGeofencePostGIS,
  getDistanceToGeofence: getDistanceToGeofence,
  getNearbyIncidents: getNearbyIncidents,
};