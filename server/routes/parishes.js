const express = require('express');
const db = require('../db/connection');
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
router.get('/', (req, res) => {
  const parishes = db.prepare(`
    SELECT slug, name, county, fill_color, svg_path FROM parishes ORDER BY id
  `).all();
  res.json(parishes);
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
router.get('/:slug', (req, res) => {
  const parish = db.prepare(`
    SELECT * FROM parishes WHERE slug = ?
  `).get(req.params.slug);

  if (!parish) {
    return res.status(404).json({ error: 'Parish not found' });
  }

  const features = db.prepare(`
    SELECT name FROM features WHERE parish_id = ? ORDER BY id
  `).all(parish.id).map(f => f.name);

  res.json({ ...parish, features });
});

module.exports = router;
