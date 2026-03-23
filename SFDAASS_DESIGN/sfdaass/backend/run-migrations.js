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

async function runAllMigrations() {
  const migrationsDir = path.join(__dirname, 'database/migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.error('Migrations directory not found');
    process.exit(1);
  }

  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  console.log(`Found ${files.length} migration files.`);

  const client = await pool.connect();
  try {
    for (const file of files) {
      console.log(`Applying migration: ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      
      // Basic block execution (can be improved with transactions per file)
      await client.query(sql);
      console.log(`✅ ${file} applied successfully.`);
    }
    console.log('\n✨ All migrations completed!');
  } catch (err) {
    console.error(`\n❌ Migration failed during ${err.currentFile || 'process'}:`);
    console.error(err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

runAllMigrations();
