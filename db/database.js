// db/database.js
// PostgreSQL + PostGIS connection pool.
// Uses the 'pg' npm package. Run: npm install pg

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
    connectionTimeoutMillis: 5000,
  });

  const client = await pool.connect();
  console.log('[DB] Connected to PostgreSQL');
  await client.query('CREATE EXTENSION IF NOT EXISTS postgis;');
  console.log('[DB] PostGIS extension ready');
  client.release();
}

// Convert SQLite ? placeholders to PostgreSQL $1 $2 $3
function toPostgres(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => '$' + (++i));
}

// Run any SQL and return the raw pg result object
async function query(sql, params) {
  if (!pool) throw new Error('DB not initialised. Call await db.init() first.');
  return pool.query(sql, params || []);
}

// INSERT / UPDATE / DELETE — returns { lastID, changes }
async function run(sql, params) {
  const pg = toPostgres(sql);
  const res = await pool.query(pg, params || []);
  const lastID = res.rows && res.rows[0] ? (res.rows[0].id || null) : null;
  return { lastID, changes: res.rowCount };
}

// SELECT one row — returns the row object or undefined
async function get(sql, params) {
  const pg = toPostgres(sql);
  const res = await pool.query(pg, params || []);
  return res.rows[0];
}

// SELECT many rows — returns array
async function all(sql, params) {
  const pg = toPostgres(sql);
  const res = await pool.query(pg, params || []);
  return res.rows;
}

function getPool() {
  return pool;
}

module.exports = { init, query, run, get, all, getPool };
