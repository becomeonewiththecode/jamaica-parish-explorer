const express = require('express');
const { query } = require('../db/pg-query');
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
router.get('/', async (req, res, next) => {
  try {
    const { rows: airports } = await query('SELECT * FROM airports ORDER BY code');
    const result = airports.map((a) => ({
      ...a,
      historical_facts:
        typeof a.historical_facts === 'string'
          ? JSON.parse(a.historical_facts)
          : a.historical_facts,
    }));
    res.json(result);
  } catch (e) {
    next(e);
  }
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
router.get('/:code', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM airports WHERE code = $1', [
      req.params.code.toUpperCase(),
    ]);
    const airport = rows[0];
    if (!airport) return res.status(404).json({ error: 'Airport not found' });
    airport.historical_facts =
      typeof airport.historical_facts === 'string'
        ? JSON.parse(airport.historical_facts)
        : airport.historical_facts;
    res.json(airport);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
