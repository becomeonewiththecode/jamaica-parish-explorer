const express = require('express');
const db = require('../db/connection');
const router = express.Router();

// GET /api/airports — all airports
router.get('/', (req, res) => {
  const airports = db.prepare('SELECT * FROM airports ORDER BY code').all();
  // Parse historical_facts JSON for each airport
  const result = airports.map(a => ({
    ...a,
    historical_facts: JSON.parse(a.historical_facts),
  }));
  res.json(result);
});

// GET /api/airports/:code — single airport by IATA code
router.get('/:code', (req, res) => {
  const airport = db.prepare('SELECT * FROM airports WHERE code = ?').get(req.params.code.toUpperCase());
  if (!airport) return res.status(404).json({ error: 'Airport not found' });
  airport.historical_facts = JSON.parse(airport.historical_facts);
  res.json(airport);
});

module.exports = router;
