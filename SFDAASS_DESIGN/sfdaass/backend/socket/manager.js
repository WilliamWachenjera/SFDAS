/**
 * Socket.IO Manager
 * Handles real-time bidirectional communication between
 * the server and dashboard clients.
 *
 * Events emitted TO clients:
 *   sensor:reading      — live sensor data from a device
 *   incident:created    — new fire incident confirmed
 *   incident:update     — existing incident updated
 *   sprinkler:activated — sprinkler zone turned on
 *   sprinkler:deactivated
 *   device:status       — device online/offline change
 *   geofence:updated    — geofence configuration changed
 *   system:heartbeat    — server alive ping every 30s
 *
 * Events received FROM clients:
 *   subscribe:device    — client wants updates for specific device
 *   sprinkler:control   — manual sprinkler override from dashboard
 *   incident:resolve    — quick resolve from dashboard
 */

const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const { queryOne, queryAll } = require('../database/db');

let ioInstance = null;

// Connected clients: socketId -> { userId, role, subscribedDevices[] }
const clients = new Map();

function init(io) {
  ioInstance = io;

  // ── Auth middleware ──────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token ||
                    socket.handshake.headers?.authorization?.split(' ')[1];

      if (!token) return next(new Error('Authentication required'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
      const user = await queryOne(
        'SELECT id, name, email, role FROM users WHERE id=$1 AND is_active=TRUE',
        [decoded.id]
      );
      if (!user) return next(new Error('User not found'));

      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  // ── Connection handler ───────────────────────────────────────
  io.on('connection', async (socket) => {
    logger.info(`Socket connected: ${socket.user.email} (${socket.id})`);
    clients.set(socket.id, { userId: socket.user.id, role: socket.user.role, subscribedDevices: [] });

    // Join role-based room
    socket.join(`role:${socket.user.role}`);
    socket.join('dashboard');

    // Send initial state on connect
    try {
      const [activeIncidents, devices, zones] = await Promise.all([
        queryAll('SELECT * FROM v_active_incidents LIMIT 10'),
        queryAll('SELECT * FROM v_device_dashboard'),
        queryAll('SELECT * FROM sprinkler_zones ORDER BY zone_code'),
      ]);

      socket.emit('init:state', { activeIncidents, devices, sprinklerZones: zones });
    } catch (err) {
      logger.error('Socket init state error:', err.message);
    }

    // ── Client events ──────────────────────────────────────────

    socket.on('subscribe:device', (deviceCode) => {
      socket.join(`device:${deviceCode}`);
      const client = clients.get(socket.id);
      if (client && !client.subscribedDevices.includes(deviceCode)) {
        client.subscribedDevices.push(deviceCode);
      }
      logger.debug(`${socket.user.email} subscribed to device: ${deviceCode}`);
    });

    socket.on('unsubscribe:device', (deviceCode) => {
      socket.leave(`device:${deviceCode}`);
    });

    socket.on('sprinkler:control', async (data) => {
      // Only admins/operators can control sprinklers via socket
      if (!['admin', 'operator'].includes(socket.user.role)) {
        socket.emit('error', { message: 'Insufficient permissions' });
        return;
      }
      const { zoneCode, action } = data;
      const status = action === 'activate' ? 'active' : 'standby';

      try {
        await queryOne(
          `UPDATE sprinkler_zones SET status=$1, last_activated=CASE WHEN $1='active' THEN NOW() ELSE last_activated END,
           last_deactivated=CASE WHEN $1='standby' THEN NOW() ELSE last_deactivated END,
           activated_by=$2 WHERE zone_code=$3 RETURNING zone_code`,
          [status, socket.user.name, zoneCode]
        );
        io.emit(`sprinkler:${action}d`, { zone: zoneCode, by: socket.user.name, timestamp: new Date() });
        logger.info(`Sprinkler ${action}: ${zoneCode} by ${socket.user.email}`);
      } catch (err) {
        socket.emit('error', { message: 'Sprinkler control failed' });
      }
    });

    socket.on('incident:resolve', async ({ incidentId, notes }) => {
      if (!['admin', 'operator'].includes(socket.user.role)) return;
      try {
        await queryOne(
          `UPDATE incidents SET status='resolved', resolved_at=NOW(), resolved_by=$1, resolution_notes=$2
           WHERE id=$3`, [socket.user.id, notes, incidentId]
        );
        io.emit('incident:resolved', { incidentId, by: socket.user.name, timestamp: new Date() });
      } catch (err) {
        socket.emit('error', { message: 'Resolve failed' });
      }
    });

    socket.on('disconnect', (reason) => {
      clients.delete(socket.id);
      logger.info(`Socket disconnected: ${socket.user.email} — ${reason}`);
    });
  });

  // ── Server heartbeat ─────────────────────────────────────────
  setInterval(() => {
    if (ioInstance) {
      ioInstance.emit('system:heartbeat', {
        timestamp: new Date().toISOString(),
        connectedClients: clients.size,
      });
    }
  }, 30000);

  // ── Device offline detection (mark offline after 2 min silence) ──
  setInterval(async () => {
    try {
      const { query } = require('../database/db');
      const result = await query(
        `UPDATE device_telemetry SET status='offline'
         WHERE status='online' AND last_seen < NOW() - INTERVAL '2 minutes'
         RETURNING device_id`
      );
      if (result.rowCount > 0 && ioInstance) {
        ioInstance.emit('device:offline-batch', { count: result.rowCount });
      }
    } catch (err) {
      // db might not be ready
    }
  }, 60000);

  logger.info('✅ Socket.IO manager initialized');
  return io;
}

function getIO() { return ioInstance; }

module.exports = { init, getIO };
