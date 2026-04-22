const { Client } = require('pg');
const bcrypt = require('bcryptjs');

async function fix() {
  const client = new Client({
    host: 'localhost',
    port: 5433,
    user: 'postgres',
    password: 'NAZIMBIRI@1404S',
    database: 'sfdaass_db'
  });

  try {
    await client.connect();
    console.log('Connected to sfdaass_db');

    const newHash = bcrypt.hashSync('Admin@1234', 12);
    console.log('New hash generated:', newHash);

    const res = await client.query(
      "UPDATE users SET password_hash = $1, login_attempts = 0, locked_until = NULL",
      [newHash]
    );
    console.log('Updated users:', res.rowCount);

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.end();
  }
}

fix();
