// db/migrate.js
// Creates all PostgreSQL tables with PostGIS geometry columns.
// Run automatically from server.js after db.init().

require('dotenv').config();
const { query } = require('./database');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

async function migrate() {
  console.log('[DB] Running migrations...');

  await query('CREATE EXTENSION IF NOT EXISTS postgis;');

  await query([
    'CREATE TABLE IF NOT EXISTS users (',
    '  id            SERIAL PRIMARY KEY,',
    '  name          TEXT NOT NULL,',
    '  email         TEXT UNIQUE NOT NULL,',
    '  password_hash TEXT NOT NULL,',
    '  role          TEXT DEFAULT \'viewer\',',
    '  phone         TEXT,',
    '  assigned_devices TEXT DEFAULT \'[]\',',
    '  is_active     INTEGER DEFAULT 1,',
    '  last_login    TIMESTAMPTZ,',
    '  created_at    TIMESTAMPTZ DEFAULT NOW(),',
    '  updated_at    TIMESTAMPTZ DEFAULT NOW()',
    ')'
  ].join(' '));

  await query([
    'CREATE TABLE IF NOT EXISTS refresh_tokens (',
    '  id         SERIAL PRIMARY KEY,',
    '  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,',
    '  token      TEXT UNIQUE NOT NULL,',
    '  expires_at TIMESTAMPTZ NOT NULL,',
    '  created_at TIMESTAMPTZ DEFAULT NOW()',
    ')'
  ].join(' '));

  await query([
    'CREATE TABLE IF NOT EXISTS password_reset_tokens (',
    '  id         SERIAL PRIMARY KEY,',
    '  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,',
    '  token      TEXT UNIQUE NOT NULL,',
    '  expires_at TIMESTAMPTZ NOT NULL,',
    '  used       INTEGER DEFAULT 0,',
    '  created_at TIMESTAMPTZ DEFAULT NOW()',
    ')'
  ].join(' '));

  // geofences — geom column stores the actual spatial boundary
  // For circles: ST_Buffer converts radius_meters into a true polygon
  // For polygons: ST_MakePolygon from user-drawn points
  await query([
    'CREATE TABLE IF NOT EXISTS geofences (',
    '  id            SERIAL PRIMARY KEY,',
    '  name          TEXT NOT NULL,',
    '  type          TEXT DEFAULT \'circle\',',
    '  center_lat    DOUBLE PRECISION,',
    '  center_lng    DOUBLE PRECISION,',
    '  radius_meters DOUBLE PRECISION DEFAULT 500,',
    '  polygon_coords TEXT,',
    '  geom          GEOMETRY(Geometry, 4326),',
    '  is_active     INTEGER DEFAULT 1,',
    '  created_at    TIMESTAMPTZ DEFAULT NOW(),',
    '  updated_at    TIMESTAMPTZ DEFAULT NOW()',
    ')'
  ].join(' '));

  await query('CREATE INDEX IF NOT EXISTS idx_geofences_geom ON geofences USING GIST (geom)');

  // devices — location column is a PostGIS Point
  // gps_lat / gps_lng kept as plain numbers for the dashboard JS
  await query([
    'CREATE TABLE IF NOT EXISTS devices (',
    '  id                 SERIAL PRIMARY KEY,',
    '  device_code        TEXT UNIQUE NOT NULL,',
    '  name               TEXT,',
    '  location_label     TEXT,',
    '  mac_address        TEXT,',
    '  firmware_version   TEXT DEFAULT \'1.0.0\',',
    '  api_key            TEXT UNIQUE,',
    '  status             TEXT DEFAULT \'offline\',',
    '  gps_lat            DOUBLE PRECISION,',
    '  gps_lng            DOUBLE PRECISION,',
    '  location           GEOMETRY(Point, 4326),',
    '  smoke_ppm          DOUBLE PRECISION,',
    '  temperature_c      DOUBLE PRECISION,',
    '  gas_ppm            DOUBLE PRECISION,',
    '  humidity_pct       DOUBLE PRECISION,',
    '  battery_pct        DOUBLE PRECISION,',
    '  flame_detected     INTEGER DEFAULT 0,',
    '  inside_geofence    INTEGER DEFAULT 1,',
    '  seconds_since_seen INTEGER DEFAULT 9999,',
    '  last_seen          TIMESTAMPTZ,',
    '  geofence_id        INTEGER REFERENCES geofences(id),',
    '  owner_name         TEXT,',
    '  owner_email        TEXT,',
    '  owner_phone        TEXT,',
    '  registered_at      TIMESTAMPTZ DEFAULT NOW()',
    ')'
  ].join(' '));

  try {
    await query('ALTER TABLE devices ADD COLUMN IF NOT EXISTS owner_name TEXT;');
    await query('ALTER TABLE devices ADD COLUMN IF NOT EXISTS owner_email TEXT;');
    await query('ALTER TABLE devices ADD COLUMN IF NOT EXISTS owner_phone TEXT;');
  } catch (err) {
    console.log('[DB] Optional owner columns notice:', err.message);
  }

  await query('CREATE INDEX IF NOT EXISTS idx_devices_location ON devices USING GIST (location)');

  await query([
    'CREATE TABLE IF NOT EXISTS sensor_readings (',
    '  id             SERIAL PRIMARY KEY,',
    '  device_id      INTEGER REFERENCES devices(id),',
    '  device_code    TEXT NOT NULL,',
    '  smoke_ppm      DOUBLE PRECISION,',
    '  temperature_c  DOUBLE PRECISION,',
    '  gas_ppm        DOUBLE PRECISION,',
    '  humidity_pct   DOUBLE PRECISION,',
    '  battery_pct    DOUBLE PRECISION,',
    '  flame_detected INTEGER DEFAULT 0,',
    '  gps_lat        DOUBLE PRECISION,',
    '  gps_lng        DOUBLE PRECISION,',
    '  location       GEOMETRY(Point, 4326),',
    '  recorded_at    TIMESTAMPTZ DEFAULT NOW()',
    ')'
  ].join(' '));

  // incidents — location column for PostGIS spatial queries
  await query([
    'CREATE TABLE IF NOT EXISTS incidents (',
    '  id                  SERIAL PRIMARY KEY,',
    '  incident_code       TEXT UNIQUE NOT NULL,',
    '  device_id           INTEGER REFERENCES devices(id),',
    '  device_code         TEXT,',
    '  location_label      TEXT,',
    '  severity            TEXT DEFAULT \'warning\',',
    '  status              TEXT DEFAULT \'active\',',
    '  smoke_ppm           DOUBLE PRECISION,',
    '  temperature_c       DOUBLE PRECISION,',
    '  gas_ppm             DOUBLE PRECISION,',
    '  humidity_pct        DOUBLE PRECISION,',
    '  flame_detected      INTEGER DEFAULT 0,',
    '  gps_lat             DOUBLE PRECISION,',
    '  gps_lng             DOUBLE PRECISION,',
    '  location            GEOMETRY(Point, 4326),',
    '  inside_geofence     INTEGER,',
    '  sprinkler_activated INTEGER DEFAULT 0,',
    '  sms_sent            INTEGER DEFAULT 0,',
    '  email_sent          INTEGER DEFAULT 0,',
    '  notes               TEXT,',
    '  acknowledged_by     INTEGER,',
    '  acknowledged_at     TIMESTAMPTZ,',
    '  resolved_by         INTEGER,',
    '  resolved_at         TIMESTAMPTZ,',
    '  resolution_secs     INTEGER,',
    '  detected_at         TIMESTAMPTZ DEFAULT NOW()',
    ')'
  ].join(' '));

  await query('CREATE INDEX IF NOT EXISTS idx_incidents_location ON incidents USING GIST (location)');

  await query([
    'CREATE TABLE IF NOT EXISTS incident_events (',
    '  id          SERIAL PRIMARY KEY,',
    '  incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,',
    '  event_type  TEXT NOT NULL,',
    '  description TEXT,',
    '  user_id     INTEGER,',
    '  occurred_at TIMESTAMPTZ DEFAULT NOW()',
    ')'
  ].join(' '));

  await query([
    'CREATE TABLE IF NOT EXISTS sprinkler_zones (',
    '  id               SERIAL PRIMARY KEY,',
    '  zone_code        TEXT UNIQUE NOT NULL,',
    '  name             TEXT,',
    '  device_id        INTEGER REFERENCES devices(id),',
    '  status           TEXT DEFAULT \'standby\',',
    '  last_activated   TIMESTAMPTZ,',
    '  last_deactivated TIMESTAMPTZ',
    ')'
  ].join(' '));

  await query([
    'CREATE TABLE IF NOT EXISTS system_config (',
    '  id         SERIAL PRIMARY KEY,',
    '  key        TEXT UNIQUE NOT NULL,',
    '  value      TEXT NOT NULL,',
    '  updated_at TIMESTAMPTZ DEFAULT NOW()',
    ')'
  ].join(' '));

  await query([
    'CREATE TABLE IF NOT EXISTS audit_logs (',
    '  id         SERIAL PRIMARY KEY,',
    '  user_id    INTEGER,',
    '  user_name  TEXT,',
    '  action     TEXT NOT NULL,',
    '  details    TEXT,',
    '  ip_address TEXT,',
    '  created_at TIMESTAMPTZ DEFAULT NOW()',
    ')'
  ].join(' '));

  console.log('[DB] All tables created.');
  await seedDefaults();
  console.log('[DB] Migration complete.');
}

async function seedDefaults() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@sfdaass.io';
  const adminPass  = process.env.ADMIN_PASSWORD || 'Admin@123';
  const adminName  = process.env.ADMIN_NAME || 'Administrator';

  const existing = await query('SELECT id FROM users WHERE email = $1', [adminEmail]);
  if (existing.rows.length === 0) {
    const hash = bcrypt.hashSync(adminPass, 10);
    await query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)',
      [adminName, adminEmail, hash, 'admin']
    );
    console.log('[DB] Admin created: ' + adminEmail + ' / ' + adminPass);
  }

  // Default geofence — UNIMA Zomba
  // ST_Buffer on a geography object creates a true-metre circle
  // then cast to geometry for storage in the geom column
  const geoEx = await query('SELECT id FROM geofences WHERE is_active = 1');
  if (geoEx.rows.length === 0) {
    await query(
      [
        'INSERT INTO geofences (name, type, center_lat, center_lng, radius_meters, geom, is_active)',
        'VALUES ($1, $2, $3, $4, $5,',
        '  ST_Buffer(',
        '    ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography,',
        '    $5',
        '  )::geometry,',
        '  1',
        ')'
      ].join(' '),
      ['UNIMA Campus', 'circle', -15.3833, 35.3333, 500]
    );
    console.log('[DB] Default geofence created (PostGIS 500m circle)');
  }

  const zones = ['ZONE-A', 'ZONE-B', 'ZONE-C', 'ZONE-D'];
  for (const z of zones) {
    const ex = await query('SELECT id FROM sprinkler_zones WHERE zone_code = $1', [z]);
    if (ex.rows.length === 0) {
      await query(
        'INSERT INTO sprinkler_zones (zone_code, name, status) VALUES ($1, $2, $3)',
        [z, z, 'standby']
      );
    }
  }

  const defaults = {
    smoke_warning:       process.env.SMOKE_WARNING_PPM   || '250',
    smoke_critical:      process.env.SMOKE_CRITICAL_PPM  || '500',
    temp_warning:        process.env.TEMP_WARNING_C      || '50',
    temp_critical:       process.env.TEMP_CRITICAL_C     || '100',
    gas_warning:         process.env.GAS_WARNING_PPM     || '150',
    gas_critical:        process.env.GAS_CRITICAL_PPM    || '300',
    confirm_duration_ms: process.env.CONFIRM_DURATION_MS || '5000',
  };

  for (const [k, v] of Object.entries(defaults)) {
    await query(
      'INSERT INTO system_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
      [k, v]
    );
  }

  const demos = [
    { code: 'ESP32-001', name: 'Block A Sensor',  loc: 'Block A, Floor 1',   lat: -15.3833, lng: 35.3333, bat: 87 },
    { code: 'ESP32-002', name: 'Library Sensor',  loc: 'University Library',  lat: -15.3840, lng: 35.3340, bat: 92 },
    { code: 'ESP32-003', name: 'Lab Sensor',      loc: 'Computer Lab',        lat: -15.3828, lng: 35.3325, bat: 45 },
  ];

  for (const d of demos) {
    const ex = await query('SELECT id FROM devices WHERE device_code = $1', [d.code]);
    if (ex.rows.length === 0) {
      await query(
        [
          'INSERT INTO devices',
          '  (device_code, name, location_label, gps_lat, gps_lng, location,',
          '   battery_pct, api_key, status, smoke_ppm, temperature_c,',
          '   gas_ppm, humidity_pct, seconds_since_seen)',
          'VALUES',
          '  ($1, $2, $3, $4, $5,',
          '   ST_SetSRID(ST_MakePoint($5, $4), 4326),',
          '   $6, $7, $8, $9, $10, $11, $12, $13)'
        ].join(' '),
        [d.code, d.name, d.loc, d.lat, d.lng,
         d.bat, uuidv4(), 'online', 45, 25, 80, 60, 30]
      );
    }
  }
}

module.exports = { migrate };
