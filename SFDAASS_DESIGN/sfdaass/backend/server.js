/**
 * SFDAASS — Smart Fire Detection, Alerting & Automated Suppression System
 * Main Server Entry Point
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server: SocketIO } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const logger = require('./utils/logger');
const { testConnection } = require('./database/db');
const socketManager = require('./socket/manager');
const mqttBridge = require('./mqtt/bridge');

// ── Routes ───────────────────────────────────────────────────────
const authRouter     = require('./routes/auth');
const sensorRouter   = require('./routes/sensor');
const devicesRouter  = require('./routes/devices');
const incidentsRouter = require('./routes/incidents');
const {
  sprinklerRouter, setSpIO,
  geofenceRouter,
  usersRouter,
  contactRouter,
  dashboardRouter,
  systemConfigRouter,
  auditRouter,
} = require('./routes/other');
const scheduler = require('./utils/scheduler');

// ── Ensure log/uploads dirs ──────────────────────────────────────
['logs', 'uploads', 'reports'].forEach(d => {
  const p = path.join(__dirname, d);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// ── App setup ────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

// ── Socket.IO ────────────────────────────────────────────────────
const io = new SocketIO(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});
socketManager.init(io);

// Inject io into routes that need it
sensorRouter.setIO(io);
setSpIO(io);

// ── Middleware ───────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Disable for development
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// HTTP request logging
app.use(morgan('combined', {
  stream: { write: (msg) => logger.http(msg.trim()) },
  skip: (req) => req.path === '/api/health',
}));

// Global rate limiter
app.use('/api/', rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '200'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests' },
  skip: (req) => req.path.startsWith('/api/sensor'), // devices exempt
}));

// Stricter limiter for auth
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many login attempts' },
}));

// ── API Routes ───────────────────────────────────────────────────
app.use('/api/auth',          authRouter);
app.use('/api/sensor',        sensorRouter);
app.use('/api/devices',       devicesRouter);
app.use('/api/incidents',     incidentsRouter);
app.use('/api/sprinklers',    sprinklerRouter);
app.use('/api/geofence',      geofenceRouter);
app.use('/api/users',         usersRouter);
app.use('/api/contact',       contactRouter);
app.use('/api/dashboard',     dashboardRouter);
app.use('/api/system-config', systemConfigRouter);
app.use('/api/audit-logs',    auditRouter);


// ── Health check ─────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  const dbOk = await testConnection().catch(() => false);
  res.json({
    status: 'ok',
    service: 'SFDAASS API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    database: dbOk ? 'connected' : 'disconnected',
    mqtt: mqttBridge ? 'configured' : 'not configured',
    uptime: Math.floor(process.uptime()),
  });
});

// ── Serve React frontend in production ───────────────────────────
if (process.env.NODE_ENV === 'production') {
  const buildPath = path.join(__dirname, '../frontend/dist');
  app.use(express.static(buildPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(buildPath, 'index.html'));
  });
}

// ── 404 handler ──────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.path}` });
});

// ── Global error handler ─────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ── Start server ─────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '5000');

async function start() {
  logger.info('═══════════════════════════════════════════');
  logger.info('  SFDAASS — Fire Safety Platform v1.0.0   ');
  logger.info('═══════════════════════════════════════════');

  // Database
  const dbOk = await testConnection();
  if (!dbOk) {
    logger.warn('⚠️  Database not connected — API will degrade gracefully');
  } else {
    scheduler.init();
  }

  // MQTT
  try {
    mqttBridge.connect(io);
  } catch (err) {
    logger.warn(`MQTT bridge skipped: ${err.message}`);
  }

  server.listen(PORT, () => {
    logger.info(`✅ HTTP server listening on port ${PORT}`);
    logger.info(`✅ Socket.IO ready on port ${PORT}`);
    logger.info(`🌐 API base: http://localhost:${PORT}/api`);
    logger.info(`❤️  Health: http://localhost:${PORT}/api/health`);
  });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down gracefully...');
  mqttBridge.disconnect();
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
});

start();

module.exports = { app, server, io };
