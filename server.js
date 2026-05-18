// server.js — SFDAASS Backend
// sql.js version: db.init() must be awaited before anything else

require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const helmet     = require('helmet');
const compression = require('compression');
const morgan     = require('morgan');
const path       = require('path');
const rateLimit  = require('express-rate-limit');

const db         = require('./db/database');
const logger     = require('./services/logger');
const { verifyAccessToken } = require('./middleware/auth');
const { verifyConnection } = require('./services/notifyService');

// ── Everything starts here, after DB is ready ──────────
async function startServer() {

  // STEP 1 — initialise database (async with sql.js)
  await db.init();

  // STEP 2 — run migrations (creates tables + seeds defaults)
  require('./db/migrate');

  const app        = express();
  const httpServer = http.createServer(app);

  // ── Socket.IO ────────────────────────────────────────
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
  });
  app.set('io', io);
  global.io = io;

  // ── Middleware ───────────────────────────────────────
  app.use(compression());
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: '*' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan('dev'));

  app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }));
  app.use('/api/',           rateLimit({ windowMs: 1  * 60 * 1000, max: 300 }));

  // ── Serve frontend HTML ──────────────────────────────
  app.use(express.static(path.join(__dirname, 'public')));

  // ── API Routes ───────────────────────────────────────
  app.use('/api/auth',          require('./routes/auth'));
  app.use('/api/dashboard',     require('./routes/dashboard'));
  app.use('/api/devices',       require('./routes/devices'));
  app.use('/api/incidents',     require('./routes/incidents'));
  app.use('/api/geofence',      require('./routes/geofence'));
  app.use('/api/sprinklers',    require('./routes/sprinklers'));
  app.use('/api/users',         require('./routes/users'));
  app.use('/api/system-config', require('./routes/systemConfig'));
  app.use('/api/audit-logs',    require('./routes/auditLogs'));
  app.use('/api/contact',       require('./routes/contact'));

  // ── SPA fallback ─────────────────────────────────────
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // ── Error handler ────────────────────────────────────
  app.use((err, req, res, next) => {
    logger.error(err.stack);
    res.status(500).json({ success: false, message: 'Internal server error' });
  });

  // ── Socket.IO auth ───────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      socket.user = verifyAccessToken(token);
      next();
    } catch (e) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.user.email}`);

    // Filter data for operators
    const isOperator = socket.user.role === 'operator';
    let assigned = [];
    if (isOperator) {
      const user = db.get('SELECT assigned_devices FROM users WHERE id = ?', [socket.user.id]);
      assigned = JSON.parse(user.assigned_devices || '[]');
      
      if (assigned.length === 0) {
        return socket.emit('init:state', { activeIncidents: [], devices: [], sprinklerZones: [] });
      }
    }

    // Send initial state to newly connected client
    const placeholders = assigned.map(() => '?').join(',');
    const deviceFilter = isOperator ? ` AND i.device_code IN (${placeholders})` : '';
    
    const activeIncidents = db.all(
      `SELECT i.* FROM incidents i WHERE i.status IN ('active','monitoring','acknowledged')${deviceFilter} ORDER BY i.detected_at DESC LIMIT 10`,
      isOperator ? assigned : []
    );
    
    const devices = isOperator 
      ? db.all(`SELECT * FROM devices WHERE device_code IN (${placeholders}) ORDER BY last_seen DESC`, assigned)
      : db.all('SELECT * FROM devices ORDER BY last_seen DESC');

    const sprinklerZones = isOperator
      ? db.all(`SELECT sz.* FROM sprinkler_zones sz JOIN devices d ON sz.device_id = d.id WHERE d.device_code IN (${placeholders})`, assigned)
      : db.all('SELECT * FROM sprinkler_zones');

    socket.emit('init:state', { activeIncidents, devices, sprinklerZones });

    // Sprinkler control from dashboard buttons
    socket.on('sprinkler:control', ({ zoneCode, action }) => {
      const isOperator = socket.user.role === 'operator';
      const zone = db.get('SELECT sz.*, d.device_code FROM sprinkler_zones sz LEFT JOIN devices d ON sz.device_id = d.id WHERE sz.zone_code = ?', [zoneCode]);
      if (!zone) return;

      if (isOperator) {
        const user = db.get('SELECT assigned_devices FROM users WHERE id = ?', [socket.user.id]);
        const assigned = JSON.parse(user.assigned_devices || '[]');
        if (!zone.device_code || !assigned.includes(zone.device_code)) {
          logger.warn(`Unauthorized sprinkler control attempt by operator ${socket.user.email} on zone ${zoneCode}`);
          return;
        }
      }

      const newStatus = action === 'activate' ? 'active' : 'standby';
      db.run('UPDATE sprinkler_zones SET status = ? WHERE zone_code = ?', [newStatus, zoneCode]);

      const mqttClient = require('./services/mqttService').getClient();
      if (mqttClient?.connected) {
        mqttClient.publish(
          `sfdaass/sprinkler/${zoneCode}`,
          JSON.stringify({ activate: action === 'activate', source: 'dashboard' })
        );
      }
      io.emit(`sprinkler:${action === 'activate' ? 'activated' : 'deactivated'}`, { zone: zoneCode });
    });

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.user.email}`);
    });
  });

  // ── Connect MQTT (ESP32 bridge) ──────────────────────
  const { connectMQTT } = require('./services/mqttService');
  connectMQTT(io);

  // ── Verify Email Service ─────────────────────────────
  await verifyConnection().catch(() => {});

  // ── Start HTTP server ────────────────────────────────
  const PORT = process.env.PORT || 5000;
  httpServer.listen(PORT, () => {
    logger.info(`\n🔥 SFDAASS Server running on http://localhost:${PORT}`);
    logger.info(`📊 Dashboard:  http://localhost:${PORT}`);
    logger.info(`🔌 API Base:   http://localhost:${PORT}/api`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
