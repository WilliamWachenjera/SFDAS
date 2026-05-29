// routes/sprinklers.js
const router = require('express').Router();
const db = require('../db/database');
const { requireAuth, requireOperator } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  try {
    const zones = await db.all('SELECT sz.*, d.device_code FROM sprinkler_zones sz LEFT JOIN devices d ON sz.device_id = d.id ORDER BY sz.zone_code');
    res.json({ success: true, zones });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.post('/:zoneCode/activate', requireOperator, async (req, res) => {
  try {
    const zone = await db.get('SELECT sz.*, d.device_code FROM sprinkler_zones sz LEFT JOIN devices d ON sz.device_id = d.id WHERE sz.zone_code = ?', [req.params.zoneCode]);
    if (!zone) return res.status(404).json({ success: false, message: 'Zone not found' });

    if (req.user.role === 'operator') {
      const user = await db.get('SELECT assigned_devices FROM users WHERE id = ?', [req.user.id]);
      const assigned = JSON.parse(user?.assigned_devices || '[]');
      if (!zone.device_code || !assigned.includes(zone.device_code)) {
        return res.status(403).json({ success: false, message: "Access denied: You are not assigned to this zone's device." });
      }
    }

    await db.run(`UPDATE sprinkler_zones SET status = 'active', last_activated = NOW() WHERE zone_code = ?`, [req.params.zoneCode]);
    const mqttClient = require('../services/mqttService').getClient();
    if (mqttClient?.connected) mqttClient.publish(`sfdaass/sprinkler/${req.params.zoneCode}`, JSON.stringify({ activate: true }));
    global.io?.emit('sprinkler:activated', { zone: req.params.zoneCode });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.post('/:zoneCode/deactivate', requireOperator, async (req, res) => {
  try {
    const zone = await db.get('SELECT sz.*, d.device_code FROM sprinkler_zones sz LEFT JOIN devices d ON sz.device_id = d.id WHERE sz.zone_code = ?', [req.params.zoneCode]);
    if (!zone) return res.status(404).json({ success: false, message: 'Zone not found' });

    if (req.user.role === 'operator') {
      const user = await db.get('SELECT assigned_devices FROM users WHERE id = ?', [req.user.id]);
      const assigned = JSON.parse(user?.assigned_devices || '[]');
      if (!zone.device_code || !assigned.includes(zone.device_code)) {
        return res.status(403).json({ success: false, message: "Access denied: You are not assigned to this zone's device." });
      }
    }

    await db.run(`UPDATE sprinkler_zones SET status = 'standby', last_deactivated = NOW() WHERE zone_code = ?`, [req.params.zoneCode]);
    const mqttClient = require('../services/mqttService').getClient();
    if (mqttClient?.connected) mqttClient.publish(`sfdaass/sprinkler/${req.params.zoneCode}`, JSON.stringify({ activate: false }));
    global.io?.emit('sprinkler:deactivated', { zone: req.params.zoneCode });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
