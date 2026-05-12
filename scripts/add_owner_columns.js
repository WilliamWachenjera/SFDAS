const db = require('../db/database');

async function migrate() {
  await db.init();
  try {
    console.log('[DB] Adding owner columns to devices table...');
    db.run('ALTER TABLE devices ADD COLUMN owner_name TEXT');
    db.run('ALTER TABLE devices ADD COLUMN owner_email TEXT');
    db.run('ALTER TABLE devices ADD COLUMN owner_phone TEXT');
    console.log('[DB] Columns added successfully.');
  } catch (e) {
    if (e.message.includes('duplicate column name')) {
      console.log('[DB] Columns already exist.');
    } else {
      console.error('[DB] Error adding columns:', e.message);
    }
  }
}

migrate();
