const db = require('./db/database');
db.init().then(async () => {
  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ id: 1, role: 'admin' }, process.env.JWT_SECRET || 'dev_secret');
  
  console.log('Sending activate request for ZONE-A...');
  try {
    const actRes = await fetch('http://localhost:5000/api/sprinklers/ZONE-A/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    });
    console.log('Activate response:', await actRes.json());
    
    // Wait 2 seconds, then deactivate
    setTimeout(async () => {
      console.log('Sending deactivate request for ZONE-A...');
      const deactRes = await fetch('http://localhost:5000/api/sprinklers/ZONE-A/deactivate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
      });
      console.log('Deactivate response:', await deactRes.json());
      process.exit(0);
    }, 2000);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
});
