const express = require('express');
const db = require('../db/connection');
const router = express.Router();

// GET /api/parishes/:slug/places — all places for a parish, optionally filtered by category
router.get('/:slug/places', (req, res) => {
  const parish = db.prepare('SELECT id FROM parishes WHERE slug = ?').get(req.params.slug);
  if (!parish) {
    return res.status(404).json({ error: 'Parish not found' });
  }

  const { category } = req.query;
  let places;

  if (category) {
    places = db.prepare(`
      SELECT id, name, category, lat, lon, address, phone, website, opening_hours, cuisine, stars
      FROM places WHERE parish_id = ? AND category = ? ORDER BY name
    `).all(parish.id, category);
  } else {
    places = db.prepare(`
      SELECT id, name, category, lat, lon, address, phone, website, opening_hours, cuisine, stars
      FROM places WHERE parish_id = ? ORDER BY category, name
    `).all(parish.id);
  }

  res.json(places);
});

// GET /api/places/categories — list all categories with counts
router.get('/categories', (req, res) => {
  const categories = db.prepare(`
    SELECT category, COUNT(*) as count FROM places GROUP BY category ORDER BY count DESC
  `).all();
  res.json(categories);
});

// GET /api/places/all — all places (lightweight: id, name, category, lat, lon) for map overlay
router.get('/all', (req, res) => {
  const { category } = req.query;
  let places;

  if (category) {
    places = db.prepare(`
      SELECT id, name, category, lat, lon FROM places WHERE category = ? ORDER BY name
    `).all(category);
  } else {
    places = db.prepare(`
      SELECT id, name, category, lat, lon FROM places ORDER BY category, name
    `).all();
  }

  res.json(places);
});

module.exports = router;
