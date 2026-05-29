// db/database.js — FIXED for PostgreSQL + PostGIS
require('dotenv').config();
const { Pool } = require('pg');

let pool = null;

async function init() {
  if (pool) return;

  pool = new Pool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME     || 'sfdaass',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASS     || '',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
  });

  try {
    const client = await pool.connect();
    console.log('[DB] Connected to PostgreSQL');
    await client.query('CREATE EXTENSION IF NOT EXISTS postgis;');
    console.log('[DB] PostGIS extension ready');
    client.release();
  } catch (e) {
    console.error('[DB] Connection failed:', e.message);
  }
}

// === IMPORTANT: Do NOT convert queries that already use $1, $2... ===
async function query(sql, params = []) {
  if (!pool) throw new Error('DB not initialised. Call await db.init() first.');
  return pool.query(sql, params);
}

async function run(sql, params = []) {
  const res = await query(sql, params);
  const lastID = res.rows && res.rows[0] ? (res.rows[0].id || null) : null;
  return { lastID, changes: res.rowCount };
}

async function get(sql, params = []) {
  const res = await query(sql, params);
  return res.rows[0];
}

async function all(sql, params = []) {
  const res = await query(sql, params);
  return res.rows;
}

function getPool() {
  return pool;
}

module.exports = { init, query, run, get, all, getPool };