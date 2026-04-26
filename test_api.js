const db = require('./db/database');
db.init().then(() => {
  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ id: 1, role: 'admin' }, process.env.JWT_SECRET || 'dev_secret');
  
  fetch('http://localhost:5000/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name: 'Test', email: 'test3@sf.com', password: 'pass', role: 'viewer', phone: '' })
  })
  .then(r => r.json())
  .then(console.log)
  .catch(console.error);
});
