// db/database.js — sql.js, pure JS, no build tools needed
require('dotenv').config();
const path = require('path');
const fs   = require('fs');
const DB_PATH = path.resolve(process.env.SQLITE_PATH || './sfdaass.db');

let rawDb = null;

async function init() {
  if (rawDb) return;
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    rawDb = new SQL.Database(fs.readFileSync(DB_PATH));
    console.log('[DB] Loaded: ' + DB_PATH);
  } else {
    rawDb = new SQL.Database();
    console.log('[DB] Created: ' + DB_PATH);
  }
  rawDb.run('PRAGMA foreign_keys = ON;');
}

function saveDb() {
  if (!rawDb) return;
  fs.writeFileSync(DB_PATH, Buffer.from(rawDb.export()));
}

function run(sql, params = []) {
  rawDb.run(sql, params);
  const r = rawDb.exec('SELECT last_insert_rowid() as id, changes() as c');
  const row = r[0] ? r[0].values[0] : [null, 0];
  saveDb();
  return { lastID: row[0], changes: row[1] };
}

function get(sql, params = []) {
  const stmt = rawDb.prepare(sql);
  stmt.bind(params);
  const found = stmt.step();
  const row = found ? stmt.getAsObject() : undefined;
  stmt.free();
  return row;
}

function all(sql, params = []) {
  try {
    const stmt = rawDb.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  } catch (e) {
    console.error('[DB] all() error:', e.message);
    return [];
  }
}

module.exports = { init, run, get, all, saveDb };
