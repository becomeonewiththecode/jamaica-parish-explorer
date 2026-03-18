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

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

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

// Simple health endpoint for status board / monitoring
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

// Admin endpoint to trigger PM2 restarts (DIY remote control).
// WARNING: This is powerful and must be protected with a strong secret token.
// Set ADMIN_RESTART_TOKEN in the server .env and send it via the X-Admin-Token header.
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
