const express = require('express');
const db = require('../db/connection');
const router = express.Router();

// GET /api/places/website-image?url=... — extract og:image from a website
router.get('/website-image', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url parameter required' });

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; JamaicaParishExplorer/1.0)',
        'Accept': 'text/html',
      },
    });
    clearTimeout(timeout);

    if (!response.ok) return res.json({ image: null });

    const html = await response.text();

    // Extract image from meta tags (og:image, twitter:image, etc.)
    const patterns = [
      /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
      /<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        let imageUrl = match[1];
        // Resolve relative URLs
        if (imageUrl.startsWith('/')) {
          imageUrl = `${parsed.protocol}//${parsed.host}${imageUrl}`;
        }
        return res.json({ image: imageUrl });
      }
    }

    res.json({ image: null });
  } catch (e) {
    res.json({ image: null });
  }
});

// GET /api/places/search?q=... — search places by name
router.get('/search', (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.json([]);

  const places = db.prepare(`
    SELECT p.id, p.name, p.category, p.lat, p.lon, par.slug as parish_slug, par.name as parish_name
    FROM places p
    JOIN parishes par ON p.parish_id = par.id
    WHERE p.name LIKE ?
    ORDER BY
      CASE WHEN p.name LIKE ? THEN 0 ELSE 1 END,
      p.name
    LIMIT 20
  `).all(`%${q.trim()}%`, `${q.trim()}%`);

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
      SELECT id, name, category, lat, lon, address, phone, website, opening_hours, cuisine, stars, description, image_url
      FROM places WHERE parish_id = ? AND category = ? ORDER BY name
    `).all(parish.id, category);
  } else {
    places = db.prepare(`
      SELECT id, name, category, lat, lon, address, phone, website, opening_hours, cuisine, stars, description, image_url
      FROM places WHERE parish_id = ? ORDER BY category, name
    `).all(parish.id);
  }

  res.json(places);
});

module.exports = router;
