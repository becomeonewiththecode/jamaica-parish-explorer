require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const util = require('util');
const { exec } = require('child_process');
const parishRoutes = require('./routes/parishes');
const noteRoutes = require('./routes/notes');
const placeRoutes = require('./routes/places');
const airportRoutes = require('./routes/airports');
const flightRoutes = require('./routes/flights');
const weatherRoutes = require('./routes/weather');
const vesselRoutes = require('./routes/vessels');
const portCruiseRoutes = require('./routes/port-cruises');
const adminDatabaseRoutes = require('./routes/admin-database');

const swagger = require('./swagger');

const app = express();
const PORT = process.env.PORT || 3001;
const execAsync = util.promisify(exec);
const { applySchema, seedParishes } = require('./db/init');

const { startRebuildInventory, getRebuildInventoryState } = require('./db/rebuild-inventory');

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
app.use('/api/admin/database', adminDatabaseRoutes);

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Server health check
 *     description: Returns server uptime, provider health (weather, waves, flights), and map-data OSM rebuild status (phase, per-category progress). Used by the status board and ops monitoring.
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
  const mapDataRebuild = getRebuildInventoryState();
  res.json({
    ok: true,
    uptime: process.uptime(),
    env: process.env.NODE_ENV || 'development',
    providers,
    waveProviders,
    flightProviders,
    mapDataRebuild,
  });
});

function safeMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function getMaxMtimeMsUnder(dirPath, { excludeDirs = [] } = {}) {
  let max = 0;
  const stack = [dirPath];

  while (stack.length > 0) {
    const current = stack.pop();
    let stat;
    try {
      stat = fs.statSync(current);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      max = Math.max(max, stat.mtimeMs);

      let entries;
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (excludeDirs.includes(entry.name)) continue;
          stack.push(path.join(current, entry.name));
        } else {
          // Only care about files' mtimes.
          stack.push(path.join(current, entry.name));
        }
      }
    } else {
      max = Math.max(max, stat.mtimeMs);
    }
  }

  return max;
}

function needsClientBuild() {
  const clientRoot = path.join(__dirname, '..', 'client');
  const distDir = path.join(clientRoot, 'dist');

  if (!fs.existsSync(distDir)) return true;

  // Source side: anything that should invalidate the Vite build output.
  const sourceFiles = [
    path.join(clientRoot, 'index.html'),
    path.join(clientRoot, 'vite.config.js'),
    path.join(clientRoot, 'package.json'),
    path.join(clientRoot, 'package-lock.json'),
  ];
  const sourceMtime = Math.max(
    ...sourceFiles.map(safeMtimeMs),
    getMaxMtimeMsUnder(path.join(clientRoot, 'src'), { excludeDirs: ['node_modules'] }),
    getMaxMtimeMsUnder(path.join(clientRoot, 'public'), { excludeDirs: ['node_modules'] }),
  );

  const outputMtime = getMaxMtimeMsUnder(distDir, { excludeDirs: ['node_modules'] });

  // A small grace period avoids false positives on filesystems with coarse timestamps.
  const GRACE_MS = 2000;
  return sourceMtime > outputMtime + GRACE_MS;
}

function truncateOutput(s, maxLen = 4000) {
  if (typeof s !== 'string') return s;
  if (s.length <= maxLen) return s;
  return s.slice(-maxLen);
}

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

  const shouldRebuildClient = (target === 'api' || target === 'all') && needsClientBuild();

  (async () => {
    let build = null;
    if (shouldRebuildClient) {
      const buildCmd = 'cd .. && npm run build';
      const { stdout, stderr } = await execAsync(buildCmd, {
        maxBuffer: 1024 * 1024 * 20,
      });
      build = {
        command: buildCmd,
        // Keep admin responses small; UI only needs to know success/failure.
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
      };
    }

    const { stdout, stderr } = await execAsync(cmd, {
      maxBuffer: 1024 * 1024 * 10,
    });
    res.json({
      ok: true,
      command: cmd,
      stdout,
      stderr,
      clientBuild: build,
      clientBuildRebuilt: Boolean(build),
    });
  })().catch((err) => {
    res.status(500).json({
      ok: false,
      error: err && err.message ? err.message : String(err),
      // best-effort details: execAsync rejection often includes stdout/stderr
      stdout: err && err.stdout ? err.stdout : undefined,
      stderr: err && err.stderr ? err.stderr : undefined,
    });
  });
});

app.get('/api/admin/rebuild-inventory/status', (req, res) => {
  const expected = process.env.ADMIN_RESTART_TOKEN;
  const provided = req.headers['x-admin-token'];
  if (!expected || !provided || provided !== expected) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }
  res.json({ ok: true, ...getRebuildInventoryState() });
});

app.post('/api/admin/rebuild-inventory', (req, res) => {
  const expected = process.env.ADMIN_RESTART_TOKEN;
  const provided = req.headers['x-admin-token'];
  if (!expected || !provided || provided !== expected) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }

  const body = req.body || {};
  const includeAirports = Boolean(body.includeAirports);
  const clearPlaces = body.clearPlaces !== false;

  const started = startRebuildInventory(
    null,
    { includeAirports, clearPlaces, onLog: (m) => console.log(m) },
    (err) => {
      if (err) console.error('[rebuild-inventory]', err);
    }
  );

  if (!started) {
    return res.status(409).json({
      ok: false,
      error: 'Rebuild already in progress',
      state: getRebuildInventoryState(),
    });
  }

  res.json({
    ok: true,
    message:
      'Rebuild started in the background. This takes several minutes (OpenStreetMap). Check server logs and GET /api/admin/rebuild-inventory/status.',
    state: getRebuildInventoryState(),
  });
});

// Central handler for async route errors (routes call next(err))
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('[api]', err);
  res.status(500).json({ ok: false, error: err.message || 'Internal server error' });
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

(async function start() {
  try {
    await applySchema();
    await seedParishes();
  } catch (e) {
    console.error('[api] Database schema/seed failed:', e);
    process.exit(1);
  }

  app.listen(PORT, HOST, () => {
    console.log(
      `Server running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} (external: 0.0.0.0)`
    );
  });
})();
