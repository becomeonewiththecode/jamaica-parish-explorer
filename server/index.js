require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const { exec } = require('child_process');
const parishRoutes = require('./routes/parishes');
const noteRoutes = require('./routes/notes');
const placeRoutes = require('./routes/places');
const airportRoutes = require('./routes/airports');
const flightRoutes = require('./routes/flights');
const weatherRoutes = require('./routes/weather');
const vesselRoutes = require('./routes/vessels');
const portCruiseRoutes = require('./routes/port-cruises');

const swagger = require('./swagger');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
swagger.setup(app);

// CORS for development (Vite runs on 5173)
if (process.env.NODE_ENV !== 'production') {
  app.use(cors());
}

// API routes
app.use('/api/parishes', parishRoutes);
app.use('/api/notes', noteRoutes);
// Also mount notes under parishes path
app.use('/api/parishes', noteRoutes);
// Places routes
app.use('/api/parishes', placeRoutes);
app.use('/api/places', placeRoutes);
app.use('/api/airports', airportRoutes);
app.use('/api/flights', flightRoutes);
app.use('/api/weather', weatherRoutes);
app.use('/api/vessels', vesselRoutes);
app.use('/api/ports', portCruiseRoutes);

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Server health check
 *     description: Returns server uptime and provider health snapshots for weather, waves, and flights. Used by the status board.
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Health status with provider details
 */
app.get('/api/health', (req, res) => {
  const providers =
    typeof weatherRoutes.getProviderHealth === 'function'
      ? weatherRoutes.getProviderHealth()
      : undefined;
  const waveProviders =
    typeof weatherRoutes.getWaveProviderHealth === 'function'
      ? weatherRoutes.getWaveProviderHealth()
      : undefined;
  const flightProviders =
    typeof flightRoutes.getFlightProviderHealth === 'function'
      ? flightRoutes.getFlightProviderHealth()
      : undefined;
  res.json({
    ok: true,
    uptime: process.uptime(),
    env: process.env.NODE_ENV || 'development',
    providers,
    waveProviders,
    flightProviders,
  });
});

/**
 * @swagger
 * /admin/restart:
 *   post:
 *     summary: Trigger PM2 process restart
 *     description: Restarts API, status board, or all PM2 processes. Requires X-Admin-Token header matching ADMIN_RESTART_TOKEN env var.
 *     tags: [Admin]
 *     parameters:
 *       - in: header
 *         name: X-Admin-Token
 *         required: true
 *         schema:
 *           type: string
 *         description: Admin secret token
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               target:
 *                 type: string
 *                 enum: [api, status, all]
 *                 default: all
 *                 description: Which PM2 process to restart
 *     responses:
 *       200:
 *         description: Restart command executed
 *       403:
 *         description: Invalid or missing token
 */
app.post('/api/admin/restart', (req, res) => {
  const expected = process.env.ADMIN_RESTART_TOKEN;
  const provided = req.headers['x-admin-token'];

  if (!expected || !provided || provided !== expected) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }

  const target = (req.body && req.body.target) || 'all';
  let cmd;
  if (target === 'api') {
    cmd = 'pm2 restart jamaica-api';
  } else if (target === 'status') {
    cmd = 'pm2 restart jamaica-status';
  } else {
    cmd = 'pm2 restart all';
  }

  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({
        ok: false,
        error: err.message,
        stderr: stderr,
      });
    }
    res.json({
      ok: true,
      command: cmd,
      stdout,
      stderr,
    });
  });
});

// Production: serve React build
if (process.env.NODE_ENV === 'production') {
  const clientDistPath = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDistPath));

  // Catch-all for SPA routes (use regex to avoid path-to-regexp '*' issues)
  app.get(/.*/, (req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} (external: 0.0.0.0)`);
});
