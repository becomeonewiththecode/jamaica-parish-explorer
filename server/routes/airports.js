const express = require('express');
const db = require('../db/connection');
const router = express.Router();

/**
 * @swagger
 * /airports:
 *   get:
 *     summary: List all airports
 *     description: Returns all Jamaican airports with parsed historical_facts JSON.
 *     tags: [Airports]
 *     responses:
 *       200:
 *         description: Array of airport objects
 */
router.get('/', (req, res) => {
  const airports = db.prepare('SELECT * FROM airports ORDER BY code').all();
  // Parse historical_facts JSON for each airport
  const result = airports.map(a => ({
    ...a,
    historical_facts: JSON.parse(a.historical_facts),
  }));
  res.json(result);
});

/**
 * @swagger
 * /airports/{code}:
 *   get:
 *     summary: Get airport by IATA code
 *     description: Returns a single airport by its IATA code (e.g. KIN, MBJ, OCJ, KTP).
 *     tags: [Airports]
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: IATA airport code
 *     responses:
 *       200:
 *         description: Airport object with historical_facts
 *       404:
 *         description: Airport not found
 */
router.get('/:code', (req, res) => {
  const airport = db.prepare('SELECT * FROM airports WHERE code = ?').get(req.params.code.toUpperCase());
  if (!airport) return res.status(404).json({ error: 'Airport not found' });
  airport.historical_facts = JSON.parse(airport.historical_facts);
  res.json(airport);
});

module.exports = router;
