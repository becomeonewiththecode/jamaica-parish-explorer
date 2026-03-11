const db = require('./connection');

// Add columns if they don't exist
try { db.exec('ALTER TABLE places ADD COLUMN description TEXT'); } catch (e) { /* already exists */ }
try { db.exec('ALTER TABLE places ADD COLUMN image_url TEXT'); } catch (e) { /* already exists */ }

// Bing image search — most reliable for finding place photos
async function tryBingImage(name, category) {
  const query = `${name} Jamaica ${category.replace(/_/g, ' ')}`;
  const url = 'https://www.bing.com/images/search?q=' + encodeURIComponent(query) + '&first=1';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/murl&quot;:&quot;(https?:\/\/[^&]+)/);
    return m ? m[1] : null;
  } catch (e) { return null; }
}

// Wikipedia exact match — returns image + description
async function tryWikipedia(name) {
  const variants = [
    name.replace(/\s+/g, '_'),
    name.replace(/\s+/g, '_') + ',_Jamaica',
  ];
  for (const title of variants) {
    try {
      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
      );
      if (!res.ok) continue;
      const data = await res.json();
      const image = data.thumbnail && data.thumbnail.source
        ? data.thumbnail.source.replace(/\/\d+px-/, '/400px-')
        : null;
      const description = data.extract || null;
      if (image || description) return { image, description };
    } catch (e) { /* skip */ }
  }
  return null;
}

// Fetch og:image from a website
async function tryWebsiteImage(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; JamaicaParishExplorer/1.0)',
        'Accept': 'text/html',
      },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const html = await res.text();

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
        if (imageUrl.startsWith('/')) {
          const parsed = new URL(url);
          imageUrl = `${parsed.protocol}//${parsed.host}${imageUrl}`;
        }
        return imageUrl;
      }
    }
  } catch (e) { /* skip */ }
  return null;
}

const updatePlace = db.prepare(`
  UPDATE places SET description = ?, image_url = ? WHERE id = ?
`);

async function main() {
  const mode = process.argv[2]; // 'all' to re-enrich everything, default only missing

  let places;
  if (mode === 'all') {
    // Reset all places and re-enrich
    db.prepare("UPDATE places SET image_url = NULL, description = NULL").run();
    places = db.prepare(`
      SELECT id, name, website, lat, lon, category
      FROM places ORDER BY name
    `).all();
  } else {
    // Only places without images
    places = db.prepare(`
      SELECT id, name, website, lat, lon, category
      FROM places
      WHERE image_url IS NULL OR image_url = ''
      ORDER BY
        CASE WHEN category IN ('tourist_attraction','landmark','beach','hotel','hospital') THEN 0 ELSE 1 END,
        name
    `).all();
  }

  console.log(`Enriching ${places.length} places...\n`);

  let withImage = 0;
  let withDesc = 0;
  let noData = 0;

  for (let i = 0; i < places.length; i++) {
    const place = places[i];
    let image = null;
    let description = null;

    // 1. Try website og:image (most relevant if available)
    if (place.website) {
      image = await tryWebsiteImage(place.website);
    }

    // 2. Try Wikipedia (for description + image)
    const wiki = await tryWikipedia(place.name);
    if (wiki) {
      if (!image && wiki.image) image = wiki.image;
      description = wiki.description;
    }

    // 3. Bing image search — finds photos for almost everything
    if (!image) {
      image = await tryBingImage(place.name, place.category);
    }

    if (image || description) {
      updatePlace.run(description || '', image || '', place.id);
      if (image) withImage++;
      if (description) withDesc++;
    } else {
      updatePlace.run('', '', place.id);
      noData++;
    }

    if ((i + 1) % 50 === 0 || i === places.length - 1) {
      console.log(`  Progress: ${i + 1}/${places.length} (${withImage} images, ${withDesc} descriptions, ${noData} no data)`);
    }

    // Rate limit: 300ms between requests to avoid being blocked
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\nDone! ${withImage} with images, ${withDesc} with descriptions, ${noData} with no data.`);

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN image_url IS NOT NULL AND image_url != '' THEN 1 ELSE 0 END) as with_image,
      SUM(CASE WHEN description IS NOT NULL AND description != '' THEN 1 ELSE 0 END) as with_desc
    FROM places
  `).get();
  console.log(`DB totals: ${stats.total} places, ${stats.with_image} with images, ${stats.with_desc} with descriptions`);

  db.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
