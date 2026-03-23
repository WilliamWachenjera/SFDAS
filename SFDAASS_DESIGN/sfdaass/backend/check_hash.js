const bcrypt = require('bcryptjs');

const hash = '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj4oFl5z7Xga';
const password = 'Admin@1234';

bcrypt.compare(password, hash, (err, res) => {
  if (err) {
    console.error('Error:', err);
  } else {
    console.log('Result:', res ? 'MATCH' : 'NO MATCH');
  }
});
