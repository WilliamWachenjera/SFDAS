// routes/sprinklers.js
const router = require('express').Router();
const db = require('../db/database');
const { requireAuth, requireOperator } = require('../middleware/auth');

router.get('/', requireAuth, (req, res) => {
  res.json({ success: true, zones: db.all('SELECT * FROM sprinkler_zones ORDER BY zone_code') });
});

router.post('/:zoneCode/activate', requireOperator, (req, res) => {
  db.run(`UPDATE sprinkler_zones SET status = 'active', last_activated = datetime('now') WHERE zone_code = ?`, [req.params.zoneCode]);
  const mqttClient = require('../services/mqttService').getClient();
  if (mqttClient?.connected) mqttClient.publish(`sfdaass/sprinkler/${req.params.zoneCode}`, JSON.stringify({ activate: true }));
  global.io?.emit('sprinkler:activated', { zone: req.params.zoneCode });
  res.json({ success: true });
});

router.post('/:zoneCode/deactivate', requireOperator, (req, res) => {
  db.run(`UPDATE sprinkler_zones SET status = 'standby', last_deactivated = datetime('now') WHERE zone_code = ?`, [req.params.zoneCode]);
  const mqttClient = require('../services/mqttService').getClient();
  if (mqttClient?.connected) mqttClient.publish(`sfdaass/sprinkler/${req.params.zoneCode}`, JSON.stringify({ activate: false }));
  global.io?.emit('sprinkler:deactivated', { zone: req.params.zoneCode });
  res.json({ success: true });
});

module.exports = router;
