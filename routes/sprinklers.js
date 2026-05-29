// routes/sprinklers.js
const router = require('express').Router();
const db     = require('../db/database');
const { requireAuth, requireOperator } = require('../middleware/auth');
const logger = require('../services/logger');

router.get('/', requireAuth, async (req, res) => {
  try {
    const zones = await db.all(`
      SELECT sz.*, d.device_code 
      FROM sprinkler_zones sz 
      LEFT JOIN devices d ON sz.device_id = d.id 
      ORDER BY sz.zone_code
    `);
    res.json({ success: true, zones });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

async function handleZoneAction(req, res, activate) {
  const { zoneCode } = req.params;
  try {
    const zone = await db.get(`
      SELECT sz.*, d.device_code 
      FROM sprinkler_zones sz 
      LEFT JOIN devices d ON sz.device_id = d.id 
      WHERE sz.zone_code = $1
    `, [zoneCode]);

    if (!zone) return res.status(404).json({ success: false, message: 'Zone not found' });

    if (req.user.role === 'operator') {
      const user     = await db.get('SELECT assigned_devices FROM users WHERE id = $1', [req.user.id]);
      const assigned = JSON.parse(user?.assigned_devices || '[]');
      if (!zone.device_code || !assigned.includes(zone.device_code)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    }

    const newStatus = activate ? 'active' : 'standby';
    await db.query(
      activate
        ? `UPDATE sprinkler_zones SET status = 'active',  last_activated   = NOW() WHERE zone_code = $1`
        : `UPDATE sprinkler_zones SET status = 'standby', last_deactivated = NOW() WHERE zone_code = $1`,
      [zoneCode]
    );

    // FIX: was QoS 0 with no error check — now QoS 1 with proper 503 on disconnect
    const mqttClient = require('../services/mqttService').getClient();
    if (!mqttClient || !mqttClient.connected) {
      return res.status(503).json({
        success: false,
        message: 'MQTT broker not connected — command NOT sent to device',
      });
    }

    const target  = zone.device_code || zoneCode;
    const payload = JSON.stringify({ activate, source: 'dashboard', ts: Date.now() });

    mqttClient.publish(
      `sfdaass/sprinkler/${target}`,
      payload,
      { qos: 1, retain: false },
      (err) => {
        if (err) logger.error(`[MQTT] Sprinkler publish failed for ${zoneCode}: ${err.message}`);
        else     logger.info(`[MQTT] Sprinkler ${activate ? 'ON' : 'OFF'} → sfdaass/sprinkler/${target}`);
      }
    );

    const io = req.app.get('io') || global.io;
    if (io) io.emit(`sprinkler:${activate ? 'activated' : 'deactivated'}`, { zone: zoneCode });

    res.json({ success: true, zoneCode, status: newStatus });

  } catch (e) {
    logger.error(`[sprinklers] ${activate ? 'activate' : 'deactivate'} ${zoneCode}: ${e.message}`);
    res.status(500).json({ success: false, message: e.message });
  }
}

// ── Per-zone routes (existing) ──────────────────────────────────────────
router.post('/:zoneCode/activate',   requireOperator, (req, res) => handleZoneAction(req, res, true));
router.post('/:zoneCode/deactivate', requireOperator, (req, res) => handleZoneAction(req, res, false));

// ── Per-device routes (new) — look up the zone by device_code then act ─
// POST /api/sprinklers/device/:deviceCode/activate
// POST /api/sprinklers/device/:deviceCode/deactivate
async function handleDeviceAction(req, res, activate) {
  const { deviceCode } = req.params;
  try {
    // Find the zone linked to this device (take the first one if multiple exist)
    const zone = await db.get(`
      SELECT sz.zone_code, d.device_code
      FROM   sprinkler_zones sz
      JOIN   devices         d  ON sz.device_id = d.id
      WHERE  d.device_code = $1
      LIMIT  1
    `, [deviceCode]);

    if (!zone) {
      return res.status(404).json({
        success: false,
        message: `No sprinkler zone found for device ${deviceCode}. Register a zone first.`,
      });
    }

    // Re-use the existing zone action with a fake params object
    req.params.zoneCode = zone.zone_code;
    return handleZoneAction(req, res, activate);
  } catch (e) {
    logger.error(`[sprinklers/device] ${deviceCode}: ${e.message}`);
    return res.status(500).json({ success: false, message: e.message });
  }
}

router.post('/device/:deviceCode/activate',   requireOperator, (req, res) => handleDeviceAction(req, res, true));
router.post('/device/:deviceCode/deactivate', requireOperator, (req, res) => handleDeviceAction(req, res, false));

module.exports = router;
