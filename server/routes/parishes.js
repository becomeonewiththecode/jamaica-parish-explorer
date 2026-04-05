const express = require('express');
const { query } = require('../db/pg-query');
const router = express.Router();

/**
 * @swagger
 * /parishes:
 *   get:
 *     summary: List all parishes
 *     description: Lightweight list of parishes with SVG paths for map rendering.
 *     tags: [Parishes]
 *     responses:
 *       200:
 *         description: Array of parishes with slug, name, county, fill_color, svg_path
 */
router.get('/', async (req, res, next) => {
  try {
    const { rows: parishes } = await query(`
    SELECT slug, name, county, fill_color, svg_path FROM parishes ORDER BY id
  `);
    res.json(parishes);
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /parishes/{slug}:
 *   get:
 *     summary: Get parish detail
 *     description: Full parish data including all columns and associated features.
 *     tags: [Parishes]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *         description: Parish slug (e.g. "st-james", "kingston")
 *     responses:
 *       200:
 *         description: Parish object with features array
 *       404:
 *         description: Parish not found
 */
router.get('/:slug', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM parishes WHERE slug = $1`, [req.params.slug]);
    const parish = rows[0];
    if (!parish) {
      return res.status(404).json({ error: 'Parish not found' });
    }

    const { rows: featRows } = await query(
      `SELECT name FROM features WHERE parish_id = $1 ORDER BY id`,
      [parish.id]
    );
    const features = featRows.map((f) => f.name);

    res.json({ ...parish, features });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
