const express = require('express');
const db = require('../db/connection');
const router = express.Router();

// GET /api/parishes — lightweight list for map rendering
router.get('/', (req, res) => {
  const parishes = db.prepare(`
    SELECT slug, name, county, fill_color, svg_path FROM parishes ORDER BY id
  `).all();
  res.json(parishes);
});

// GET /api/parishes/:slug — full detail + features
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
