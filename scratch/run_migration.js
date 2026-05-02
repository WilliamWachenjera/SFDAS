const db = require('../db/database');
async function runMigration() {
    await db.init();
    require('../db/migrate');
    console.log('Migration completed successfully.');
}
runMigration().catch(console.error);
