// routes/sprinklers.js
const router = require('express').Router();
const db = require('../db/database');
const { requireAuth, requireOperator } = require('../middleware/auth');

router.get('/', requireAuth, (req, res) => {
  res.json({ success: true, zones: db.all('SELECT sz.*, d.device_code FROM sprinkler_zones sz LEFT JOIN devices d ON sz.device_id = d.id ORDER BY sz.zone_code') });
});

router.post('/:zoneCode/activate', requireOperator, (req, res) => {
  const zone = db.get('SELECT sz.*, d.device_code FROM sprinkler_zones sz LEFT JOIN devices d ON sz.device_id = d.id WHERE sz.zone_code = ?', [req.params.zoneCode]);
  if (!zone) return res.status(404).json({ success: false, message: 'Zone not found' });

  if (req.user.role === 'operator') {
    const user = db.get('SELECT assigned_devices FROM users WHERE id = ?', [req.user.id]);
    const assigned = JSON.parse(user.assigned_devices || '[]');
    if (!zone.device_code || !assigned.includes(zone.device_code)) {
      return res.status(403).json({ success: false, message: "Access denied: You are not assigned to this zone's device." });
    }
  }

  db.run(`UPDATE sprinkler_zones SET status = 'active', last_activated = datetime('now') WHERE zone_code = ?`, [req.params.zoneCode]);
  const mqttClient = require('../services/mqttService').getClient();
  if (mqttClient?.connected) mqttClient.publish(`sfdaass/sprinkler/${req.params.zoneCode}`, JSON.stringify({ activate: true }));
  global.io?.emit('sprinkler:activated', { zone: req.params.zoneCode });
  res.json({ success: true });
});

router.post('/:zoneCode/deactivate', requireOperator, (req, res) => {
  const zone = db.get('SELECT sz.*, d.device_code FROM sprinkler_zones sz LEFT JOIN devices d ON sz.device_id = d.id WHERE sz.zone_code = ?', [req.params.zoneCode]);
  if (!zone) return res.status(404).json({ success: false, message: 'Zone not found' });

  if (req.user.role === 'operator') {
    const user = db.get('SELECT assigned_devices FROM users WHERE id = ?', [req.user.id]);
    const assigned = JSON.parse(user.assigned_devices || '[]');
    if (!zone.device_code || !assigned.includes(zone.device_code)) {
      return res.status(403).json({ success: false, message: "Access denied: You are not assigned to this zone's device." });
    }
  }

  db.run(`UPDATE sprinkler_zones SET status = 'standby', last_deactivated = datetime('now') WHERE zone_code = ?`, [req.params.zoneCode]);
  const mqttClient = require('../services/mqttService').getClient();
  if (mqttClient?.connected) mqttClient.publish(`sfdaass/sprinkler/${req.params.zoneCode}`, JSON.stringify({ activate: false }));
  global.io?.emit('sprinkler:deactivated', { zone: req.params.zoneCode });
  res.json({ success: true });
});

module.exports = router;
