require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433'),
  database: process.env.DB_NAME || 'sfdaass_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'NAZIMBIRI@1404S',
});

async function runMigration() {
  console.log('--- Migration Diagnostic ---');
  console.log('Database Host:', process.env.DB_HOST || 'localhost');
  console.log('Database User:', process.env.DB_USER || 'postgres');
  console.log('Database Name:', process.env.DB_NAME || 'sfdaass_db');
  console.log('Password length:', (process.env.DB_PASSWORD || '').length);
  console.log('---------------------------');

  const sqlPath = path.join(__dirname, 'database/migrations/v2_auth_updates.sql');
  if (!fs.existsSync(sqlPath)) {
    console.error('Migration SQL file not found at:', sqlPath);
    return;
  }
  const sql = fs.readFileSync(sqlPath, 'utf-8');
  
  console.log('Connecting to database...');
  try {
    await pool.query(sql);
    console.log('✅ Migration successful!');
  } catch (err) {
    console.error('❌ Migration failed!');
    console.error('Error Code:', err.code);
    console.error('Message:', err.message);
    if (err.code === '28P01') {
      console.log('\n[Troubleshooting] Authentication failed. Please verify that:');
      console.log('1. The password in .env matches your PostgreSQL password for user "' + (process.env.DB_USER || 'postgres') + '".');
      console.log('2. The user has permission to connect to database "' + (process.env.DB_NAME || 'sfdaass_db') + '".');
    }
  } finally {
    await pool.end();
  }
}

runMigration();
