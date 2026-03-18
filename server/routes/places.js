const express = require('express');
const db = require('../db/connection');
const router = express.Router();

/**
 * @swagger
 * /places/website-image:
 *   get:
 *     summary: Extract og:image from a URL
 *     description: Fetches the given URL and extracts the Open Graph or Twitter image meta tag.
 *     tags: [Places]
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema:
 *           type: string
 *         description: Website URL to extract image from
 *     responses:
 *       200:
 *         description: "{ image: string | null }"
 *       400:
 *         description: Missing or invalid URL
 */
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

/**
 * @swagger
 * /places/search:
 *   get:
 *     summary: Search places by name
 *     description: Returns up to 10 places matching the query string. Minimum 2 characters required.
 *     tags: [Places]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query (min 2 chars)
 *     responses:
 *       200:
 *         description: Array of matching places with id, name, category, lat, lon, parish_slug, parish_name
 */
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
    LIMIT 10
  `).all(`%${q.trim()}%`, `${q.trim()}%`);

  res.json(places);
});

/**
 * @swagger
 * /places/categories:
 *   get:
 *     summary: List place categories
 *     description: Returns all place categories with their counts, sorted by count descending.
 *     tags: [Places]
 *     responses:
 *       200:
 *         description: Array of { category, count }
 */
router.get('/categories', (req, res) => {
  const categories = db.prepare(`
    SELECT category, COUNT(*) as count FROM places GROUP BY category ORDER BY count DESC
  `).all();
  res.json(categories);
});

/**
 * @swagger
 * /places/all:
 *   get:
 *     summary: Get all places
 *     description: Lightweight list of all places for map overlay. Optionally filter by category.
 *     tags: [Places]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category (e.g. "restaurant", "hotel")
 *     responses:
 *       200:
 *         description: Array of places with id, name, category, lat, lon
 */
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

/**
 * @swagger
 * /parishes/{slug}/places:
 *   get:
 *     summary: Get places for a parish
 *     description: Returns all places in a parish with full detail. Optionally filter by category.
 *     tags: [Places]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *         description: Parish slug
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *     responses:
 *       200:
 *         description: Array of places with full detail (address, phone, website, hours, etc.)
 *       404:
 *         description: Parish not found
 */
router.get('/:slug/places', (req, res) => {
  const parish = db.prepare('SELECT id FROM parishes WHERE slug = ?').get(req.params.slug);
  if (!parish) {
    return res.status(404).json({ error: 'Parish not found' });
  }

  const { category } = req.query;
  let places;

  if (category) {
    places = db.prepare(`
      SELECT id, name, category, lat, lon, address, phone, website, opening_hours, cuisine, stars, description, image_url, menu_url, tiktok_url, instagram_url, booking_url, tripadvisor_url
      FROM places WHERE parish_id = ? AND category = ? ORDER BY name
    `).all(parish.id, category);
  } else {
    places = db.prepare(`
      SELECT id, name, category, lat, lon, address, phone, website, opening_hours, cuisine, stars, description, image_url, menu_url, tiktok_url, instagram_url, booking_url, tripadvisor_url
      FROM places WHERE parish_id = ? ORDER BY category, name
    `).all(parish.id);
  }

  res.json(places);
});

module.exports = router;
