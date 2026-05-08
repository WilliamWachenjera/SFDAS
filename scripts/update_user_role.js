// update_user_role.js
const db = require('../db/database');
(async () => {
  await db.init();
  const email = 'bsc-com-ne-06-22@unima.ac.mw';
  const user = db.get('SELECT id, role FROM users WHERE email = ?', [email]);
  if (!user) {
    console.log('User not found');
    process.exit(1);
  }
  db.run('UPDATE users SET role = ? WHERE id = ?', ['admin', user.id]);
  console.log(`Updated user ${email} to admin role`);
})();
