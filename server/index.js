require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const parishRoutes = require('./routes/parishes');
const noteRoutes = require('./routes/notes');
const placeRoutes = require('./routes/places');
const airportRoutes = require('./routes/airports');
const flightRoutes = require('./routes/flights');

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

// Production: serve React build
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'client', 'dist', 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
