require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
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
