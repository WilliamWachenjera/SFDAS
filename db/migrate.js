// db/migrate.js — creates all tables and seeds defaults
// Called synchronously from server.js after db.init() completes

require('dotenv').config();
const { run, get, all } = require('./database');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

function migrate() {
  console.log('[DB] Running migrations...');

  run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'viewer',
    phone TEXT,
    assigned_devices TEXT DEFAULT '[]',
    is_active INTEGER DEFAULT 1,
    last_login TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  // Ensure assigned_devices column exists for older schemas
  const userCols = all('PRAGMA table_info(users)');
  if (!userCols.find(c => c.name === 'assigned_devices')) {
    console.log('[DB] Adding missing column: users.assigned_devices');
    run('ALTER TABLE users ADD COLUMN assigned_devices TEXT DEFAULT "[]"');
  }


  run(`CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  run(`CREATE TABLE IF NOT EXISTS geofences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'circle',
    center_lat REAL,
    center_lng REAL,
    radius_meters REAL DEFAULT 500,
    polygon_coords TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  run(`CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_code TEXT UNIQUE NOT NULL,
    name TEXT,
    location_label TEXT,
    mac_address TEXT,
    firmware_version TEXT DEFAULT '1.0.0',
    api_key TEXT UNIQUE,
    status TEXT DEFAULT 'offline',
    gps_lat REAL,
    gps_lng REAL,
    smoke_ppm REAL,
    temperature_c REAL,
    gas_ppm REAL,
    humidity_pct REAL,
    battery_pct REAL,
    flame_detected INTEGER DEFAULT 0,
    inside_geofence INTEGER DEFAULT 1,
    seconds_since_seen INTEGER DEFAULT 9999,
    last_seen TEXT,
    geofence_id INTEGER,
    registered_at TEXT DEFAULT (datetime('now'))
  )`);

  run(`CREATE TABLE IF NOT EXISTS sensor_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER,
    device_code TEXT NOT NULL,
    smoke_ppm REAL,
    temperature_c REAL,
    gas_ppm REAL,
    humidity_pct REAL,
    battery_pct REAL,
    flame_detected INTEGER DEFAULT 0,
    gps_lat REAL,
    gps_lng REAL,
    recorded_at TEXT DEFAULT (datetime('now'))
  )`);

  run(`CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_code TEXT UNIQUE NOT NULL,
    device_id INTEGER,
    device_code TEXT,
    location_label TEXT,
    severity TEXT DEFAULT 'warning',
    status TEXT DEFAULT 'active',
    smoke_ppm REAL,
    temperature_c REAL,
    gas_ppm REAL,
    humidity_pct REAL,
    flame_detected INTEGER DEFAULT 0,
    gps_lat REAL,
    gps_lng REAL,
    inside_geofence INTEGER,
    sprinkler_activated INTEGER DEFAULT 0,
    sms_sent INTEGER DEFAULT 0,
    email_sent INTEGER DEFAULT 0,
    notes TEXT,
    acknowledged_by INTEGER,
    acknowledged_at TEXT,
    resolved_by INTEGER,
    resolved_at TEXT,
    resolution_secs INTEGER,
    detected_at TEXT DEFAULT (datetime('now'))
  )`);

  run(`CREATE TABLE IF NOT EXISTS incident_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    description TEXT,
    user_id INTEGER,
    occurred_at TEXT DEFAULT (datetime('now'))
  )`);

  run(`CREATE TABLE IF NOT EXISTS sprinkler_zones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zone_code TEXT UNIQUE NOT NULL,
    name TEXT,
    device_id INTEGER,
    status TEXT DEFAULT 'standby',
    last_activated TEXT,
    last_deactivated TEXT
  )`);

  run(`CREATE TABLE IF NOT EXISTS system_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  run(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    user_name TEXT,
    action TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  run(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  seedDefaults();
  console.log('[DB] Migrations complete.');
}

function seedDefaults() {
  // Default admin account
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@sfdaass.io';
  const adminPass  = process.env.ADMIN_PASSWORD || 'Admin@123';
  const adminName  = process.env.ADMIN_NAME || 'Administrator';

  const existing = get('SELECT id, email, name FROM users WHERE role = "admin" LIMIT 1');
  if (!existing) {
    const hash = bcrypt.hashSync(adminPass, 10);
    run('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [adminName, adminEmail, hash, 'admin']);
    console.log(`[DB] Admin created: ${adminEmail} / ${adminPass}`);
  } else {
    // If settings changed in .env, update the existing admin
    if (existing.email !== adminEmail || existing.name !== adminName) {
      run('UPDATE users SET email = ?, name = ? WHERE id = ?', [adminEmail, adminName, existing.id]);
      console.log(`[DB] Admin updated to match .env: ${adminEmail}`);
    }
  }

  // Default geofence (UNIMA Zomba)
  const geo = get('SELECT id FROM geofences WHERE is_active = 1');
  if (!geo) {
    run('INSERT INTO geofences (name, type, center_lat, center_lng, radius_meters) VALUES (?, ?, ?, ?, ?)',
      ['UNIMA Campus', 'circle', -15.3833, 35.3333, 500]);
  }

  // Default sprinkler zones
  ['ZONE-A', 'ZONE-B', 'ZONE-C', 'ZONE-D'].forEach(z => {
    const ex = get('SELECT id FROM sprinkler_zones WHERE zone_code = ?', [z]);
    if (!ex) run('INSERT INTO sprinkler_zones (zone_code, name, status) VALUES (?, ?, ?)', [z, z, 'standby']);
  });

  // Default thresholds
  const defaults = {
    smoke_warning:      process.env.SMOKE_WARNING_PPM  || '250',
    smoke_critical:     process.env.SMOKE_CRITICAL_PPM || '500',
    temp_warning:       process.env.TEMP_WARNING_C     || '50',
    temp_critical:      process.env.TEMP_CRITICAL_C    || '100',
    gas_warning:        process.env.GAS_WARNING_PPM    || '150',
    gas_critical:       process.env.GAS_CRITICAL_PPM   || '300',
    confirm_duration_ms: process.env.CONFIRM_DURATION_MS || '5000',
  };
  Object.entries(defaults).forEach(([k, v]) => {
    const ex = get('SELECT id FROM system_config WHERE key = ?', [k]);
    if (!ex) run('INSERT INTO system_config (key, value) VALUES (?, ?)', [k, v]);
  });

  // Demo devices
  const demoDevices = [
    { code: 'ESP32-001', name: 'Block A Sensor',  loc: 'Block A, Floor 1',    lat: -15.3833, lng: 35.3333, bat: 87 },
    { code: 'ESP32-002', name: 'Library Sensor',  loc: 'University Library',   lat: -15.3840, lng: 35.3340, bat: 92 },
    { code: 'ESP32-003', name: 'Lab Sensor',      loc: 'Computer Lab',         lat: -15.3828, lng: 35.3325, bat: 45 },
  ];
  demoDevices.forEach(d => {
    const ex = get('SELECT id FROM devices WHERE device_code = ?', [d.code]);
    if (!ex) {
      run(
        `INSERT INTO devices
           (device_code, name, location_label, gps_lat, gps_lng, battery_pct,
            api_key, status, smoke_ppm, temperature_c, gas_ppm, humidity_pct, seconds_since_seen)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [d.code, d.name, d.loc, d.lat, d.lng, d.bat,
         uuidv4(), 'online', 45, 25, 80, 60, 30]
      );
    }
  });
}

migrate();
