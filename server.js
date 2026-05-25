// server.js — PostgreSQL + PostGIS version
// Key change from sql.js version:
//   - db.init() is still called but it now connects to PostgreSQL
//   - No more sql.js WASM loading
//   - Everything else is identical to your current server.js

require('dotenv').config();
const express     = require('express');
const http        = require('http');
const { Server }  = require('socket.io');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const morgan      = require('morgan');
const path        = require('path');
const rateLimit   = require('express-rate-limit');

const db          = require('./db/database');
const logger      = require('./services/logger');
const { verifyAccessToken }  = require('./middleware/auth');
const { verifyConnection }   = require('./services/notifyService');

async function startServer() {

  // STEP 1 — Connect to PostgreSQL + enable PostGIS
  await db.init();

  // STEP 2 — Create tables and seed defaults
  require('./db/migrate');

  const app        = express();
  const httpServer = http.createServer(app);

  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
  });
  app.set('io', io);
  global.io = io;

  app.use(compression());
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: '*' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan('dev'));
  app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }));
  app.use('/api/',           rateLimit({ windowMs: 1  * 60 * 1000, max: 300 }));

  app.use(express.static(path.join(__dirname, 'public')));

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

  app.get('*', (req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
  );

  app.use((err, req, res, next) => {
    logger.error(err.stack);
    res.status(500).json({ success: false, message: 'Internal server error' });
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try { socket.user = verifyAccessToken(token); next(); }
    catch (e) { next(new Error('Invalid token')); }
  });

  io.on('connection', async (socket) => {
    logger.info(`Socket connected: ${socket.user.email}`);

    const isOperator = socket.user.role === 'operator';
    let assigned = [];
    if (isOperator) {
      const user = await db.get('SELECT assigned_devices FROM users WHERE id = $1', [socket.user.id]);
      assigned = JSON.parse(user?.assigned_devices || '[]');
      if (assigned.length === 0) {
        return socket.emit('init:state', { activeIncidents: [], devices: [], sprinklerZones: [] });
      }
    }

    const activeIncidents = isOperator
      ? await db.all(
          `SELECT * FROM incidents WHERE status IN ('active','monitoring','acknowledged')
           AND device_code = ANY($1) ORDER BY detected_at DESC LIMIT 10`,
          [assigned])
      : await db.all(
          `SELECT * FROM incidents WHERE status IN ('active','monitoring','acknowledged')
           ORDER BY detected_at DESC LIMIT 10`);

    const devices = isOperator
      ? await db.all('SELECT * FROM devices WHERE device_code = ANY($1) ORDER BY last_seen DESC', [assigned])
      : await db.all('SELECT * FROM devices ORDER BY last_seen DESC');

    const sprinklerZones = isOperator
      ? await db.all(
          `SELECT sz.* FROM sprinkler_zones sz
           JOIN devices d ON sz.device_id = d.id
           WHERE d.device_code = ANY($1)`, [assigned])
      : await db.all('SELECT * FROM sprinkler_zones');

    socket.emit('init:state', { activeIncidents, devices, sprinklerZones });

    socket.on('sprinkler:control', async ({ zoneCode, action }) => {
      const newStatus = action === 'activate' ? 'active' : 'standby';
      await db.query('UPDATE sprinkler_zones SET status = $1 WHERE zone_code = $2', [newStatus, zoneCode]);
      const mqttClient = require('./services/mqttService').getClient();
      if (mqttClient?.connected) {
        mqttClient.publish(
          `sfdaass/sprinkler/${zoneCode}`,
          JSON.stringify({ activate: action === 'activate', source: 'dashboard' })
        );
      }
      io.emit(`sprinkler:${action === 'activate' ? 'activated' : 'deactivated'}`, { zone: zoneCode });
    });

    socket.on('disconnect', () =>
      logger.info(`Socket disconnected: ${socket.user.email}`)
    );
  });

  const { connectMQTT } = require('./services/mqttService');
  connectMQTT(io);

  await verifyConnection().catch(() => {});

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
