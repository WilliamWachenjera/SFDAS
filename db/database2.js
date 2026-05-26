// db/database.js
// PostgreSQL + PostGIS version
// Replaces the sql.js SQLite version entirely.
// All queries now use $1/$2 placeholders (PostgreSQL style).

require('dotenv').config();
const { Pool } = require('pg');

let pool = null;

// ── Create the connection pool ─────────────────────────
async function init() {
  if (pool) return; // already initialised

  pool = new Pool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME     || 'sfdaass',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASS     || '',
    max:      10,           // max connections in pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  // Test the connection
  const client = await pool.connect();
  console.log('[DB] ✅ Connected to PostgreSQL');

  // Enable PostGIS extension
  await client.query('CREATE EXTENSION IF NOT EXISTS postgis;');
  console.log('[DB] ✅ PostGIS extension enabled');

  client.release();
}

// ── query() — raw PostgreSQL query, returns full result ─
async function query(sql, params = []) {
  if (!pool) throw new Error('DB not initialised. Call db.init() first.');
  return pool.query(sql, params);
}

// ── run() — execute INSERT/UPDATE/DELETE ──────────────
// Returns { lastID, changes } to stay compatible with old API
async function run(sql, params = []) {
  // Convert SQLite ? placeholders to PostgreSQL $1 $2 style
  const pgSql = toPostgres(sql);
  const res = await pool.query(pgSql, params);
  // For INSERT ... RETURNING id, grab the id
  const lastID = res.rows[0]?.id ?? null;
  return { lastID, changes: res.rowCount };
}

// ── get() — return single row or undefined ─────────────
async function get(sql, params = []) {
  const pgSql = toPostgres(sql);
  const res = await pool.query(pgSql, params);
  return res.rows[0];
}

// ── all() — return array of rows ──────────────────────
async function all(sql, params = []) {
  const pgSql = toPostgres(sql);
  const res = await pool.query(pgSql, params);
  return res.rows;
}

// ── Convert SQLite ? params to PostgreSQL $1 $2 ───────
// This lets old query strings mostly work with minor edits.
function toPostgres(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// ── getPool() — for advanced use (transactions etc.) ──
function getPool() { return pool; }

module.exports = { init, query, run, get, all, getPool };
