const { Client } = require('pg');

async function test() {
  const client = new Client({
    host: 'localhost',
    port: 5433,
    user: 'postgres',
    password: 'NAZIMBIRI@1404S',
    database: 'postgres'
  });

  try {
    await client.connect();
    console.log('SUCCESS: Connected to postgres');
    const res = await client.query("SELECT 1 FROM pg_database WHERE datname='sfdaass_db'");
    if (res.rows.length > 0) {
      console.log('SUCCESS: sfdaass_db exists');
    } else {
      console.log('INFO: sfdaass_db does not exist');
    }
  } catch (err) {
    console.error('FAILURE:', err.message);
  } finally {
    await client.end();
  }
}

test();
