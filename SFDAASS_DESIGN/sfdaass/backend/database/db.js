const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'sfdaass_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '1400',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  logger.error('Unexpected PG pool error', err);
});

// Helper: run query with automatic logging
const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) logger.warn(`Slow query (${duration}ms): ${text.substring(0, 80)}`);
    return res;
  } catch (err) {
    logger.error(`DB Query error: ${err.message}`, { text: text.substring(0, 120) });
    throw err;
  }
};

// Helper: get single row
const queryOne = async (text, params) => {
  const res = await query(text, params);
  return res.rows[0] || null;
};

// Helper: get all rows
const queryAll = async (text, params) => {
  const res = await query(text, params);
  return res.rows;
};

// Helper: transaction
const withTransaction = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const testConnection = async () => {
  try {
    const res = await pool.query('SELECT NOW() AS time, current_database() AS db');
    logger.info(`✅ PostgreSQL connected: ${res.rows[0].db} @ ${res.rows[0].time}`);
    return true;
  } catch (err) {
    logger.error(`❌ PostgreSQL connection failed: ${err.message}`);
    return false;
  }
};

module.exports = { pool, query, queryOne, queryAll, withTransaction, testConnection };
