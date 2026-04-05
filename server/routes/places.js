const express = require('express');
const { query } = require('../db/pg-query');
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
        Accept: 'text/html',
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
router.get('/search', async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) return res.json([]);

    const like = `%${q.trim()}%`;
    const prefix = `${q.trim()}%`;
    const { rows: places } = await query(
      `
    SELECT p.id, p.name, p.category, p.lat, p.lon, par.slug as parish_slug, par.name as parish_name
    FROM places p
    JOIN parishes par ON p.parish_id = par.id
    WHERE p.name ILIKE $1
    ORDER BY
      CASE WHEN p.name ILIKE $2 THEN 0 ELSE 1 END,
      p.name
    LIMIT 10
  `,
      [like, prefix]
    );

    res.json(places);
  } catch (e) {
    next(e);
  }
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
router.get('/categories', async (req, res, next) => {
  try {
    const { rows: categories } = await query(`
    SELECT category, COUNT(*)::bigint AS count FROM places GROUP BY category ORDER BY count DESC
  `);
    res.json(categories);
  } catch (e) {
    next(e);
  }
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
router.get('/all', async (req, res, next) => {
  try {
    const { category } = req.query;
    let places;
    if (category) {
      const r = await query(
        `
      SELECT id, name, category, lat, lon FROM places WHERE category = $1 ORDER BY name
    `,
        [category]
      );
      places = r.rows;
    } else {
      const r = await query(`
      SELECT id, name, category, lat, lon FROM places ORDER BY category, name
    `);
      places = r.rows;
    }
    res.json(places);
  } catch (e) {
    next(e);
  }
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
router.get('/:slug/places', async (req, res, next) => {
  try {
    const pr = await query('SELECT id FROM parishes WHERE slug = $1', [req.params.slug]);
    const parish = pr.rows[0];
    if (!parish) {
      return res.status(404).json({ error: 'Parish not found' });
    }

    const { category } = req.query;
    let places;
    if (category) {
      const r = await query(
        `
      SELECT id, name, category, lat, lon, address, phone, website, opening_hours, cuisine, stars, description, image_url, menu_url, tiktok_url, instagram_url, booking_url, tripadvisor_url
      FROM places WHERE parish_id = $1 AND category = $2 ORDER BY name
    `,
        [parish.id, category]
      );
      places = r.rows;
    } else {
      const r = await query(
        `
      SELECT id, name, category, lat, lon, address, phone, website, opening_hours, cuisine, stars, description, image_url, menu_url, tiktok_url, instagram_url, booking_url, tripadvisor_url
      FROM places WHERE parish_id = $1 ORDER BY category, name
    `,
        [parish.id]
      );
      places = r.rows;
    }

    res.json(places);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
