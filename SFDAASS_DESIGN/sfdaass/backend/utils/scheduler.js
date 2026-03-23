const cron = require('node-cron');
const { queryAll, query } = require('../database/db');
const { sendWeeklySummary } = require('./notifications');
const logger = require('./logger');

function init() {
  // Weekly email cron - every Monday at 8:00 AM
  cron.schedule('0 8 * * 1', async () => {
    logger.info('Running weekly summary cron job');
    try {
      // Collect incidents from last 7 days
      const incidents = await queryAll(`
        SELECT * FROM incidents 
        WHERE detected_at >= NOW() - INTERVAL '7 days'
      `);
      
      const adminUsers = await queryAll(`SELECT email FROM users WHERE role='admin'`);
      const emails = adminUsers.map(u => u.email).join(',');

      if (emails) {
        await sendWeeklySummary(emails, incidents);
      }
    } catch (err) {
      logger.error('Failed to run weekly summary cron:', err.message);
    }
  });

  // Maintenance window monitor - every 1 minute
  cron.schedule('* * * * *', async () => {
    try {
      // Find all maintenance windows that are active right now
      const activeWindows = await queryAll(`
        SELECT device_id FROM device_maintenance_windows 
        WHERE is_active = TRUE AND NOW() >= start_time AND NOW() <= end_time
      `);
      
      const activeDeviceIds = activeWindows.map(w => w.device_id);

      // Set these devices to 'maintenance' status if they aren't already
      if (activeDeviceIds.length > 0) {
        await query(`
          UPDATE device_telemetry SET status = 'maintenance' 
          WHERE device_id = ANY($1) AND status != 'maintenance'
        `, [activeDeviceIds]);
      }

      // Also set any device that is 'maintenance' but has no active windows back to 'online' or 'offline'
      await query(`
        UPDATE device_telemetry SET status = 'online'
        WHERE status = 'maintenance' 
        ${activeDeviceIds.length > 0 ? 'AND device_id != ALL($1)' : ''}
      `, activeDeviceIds.length > 0 ? [activeDeviceIds] : []);

    } catch (err) {
      logger.error('Maintenance window monitor error:', err.message);
    }
  });

  logger.info('Scheduler initialized');
}

module.exports = { init };
