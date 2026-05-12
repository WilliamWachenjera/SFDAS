// db/database.js — better-sqlite3 version
require('dotenv').config();
const path = require('path');
const fs   = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.resolve(__dirname, '..', process.env.SQLITE_PATH || 'sfdaass.db');

let db = null;

async function init() {
  if (db) return;
  
  // Ensure directory exists
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(DB_PATH, { 
    // verbose: console.log 
  });
  
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL'); // Better for concurrent access
  
  console.log('[DB] Connected: ' + DB_PATH);
}

function run(sql, params = []) {
  const stmt = db.prepare(sql);
  const info = stmt.run(params);
  return { lastID: info.lastInsertRowid, changes: info.changes };
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.get(params);
}

function all(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    return stmt.all(params);
  } catch (e) {
    console.error('[DB] all() error:', e.message);
    return [];
  }
}

// Dummy saveDb for backward compatibility if needed, but better-sqlite3 persists automatically
function saveDb() {
  // Not needed with better-sqlite3
}

module.exports = { init, run, get, all, saveDb };

