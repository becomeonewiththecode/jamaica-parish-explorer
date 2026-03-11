const db = require('./connection');
const fs = require('fs');
const path = require('path');

// Run the places table migration
db.exec(`
CREATE TABLE IF NOT EXISTS places (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    parish_id   INTEGER NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
    osm_id      TEXT UNIQUE,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL,
    lat         REAL NOT NULL,
    lon         REAL NOT NULL,
    address     TEXT,
    phone       TEXT,
    website     TEXT,
    opening_hours TEXT,
    cuisine     TEXT,
    stars       INTEGER,
    fetched_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_places_parish ON places(parish_id);
CREATE INDEX IF NOT EXISTS idx_places_category ON places(category);
CREATE INDEX IF NOT EXISTS idx_places_osm ON places(osm_id);
`);

// Load GeoJSON to get parish boundaries for point-in-polygon matching
const geojsonPath = path.join(__dirname, '..', '..', 'client', 'public', 'jamaica-parishes.geojson');
const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));

const nameToSlug = {
  "Hanover": "hanover", "Westmoreland": "westmoreland",
  "Saint James": "st-james", "Trelawny": "trelawny",
  "Saint Ann": "st-ann", "Saint Elizabeth": "st-elizabeth",
  "Manchester": "manchester", "Clarendon": "clarendon",
  "Saint Mary": "st-mary", "Saint Catherine": "st-catherine",
  "Saint Andrew": "st-andrew", "Kingston": "kingston",
  "Saint Thomas": "st-thomas", "Portland": "portland",
};

// Simple ray-casting point-in-polygon
function pointInPolygon(lat, lon, polygon) {
  // polygon is an array of rings; use outer ring (first)
  const ring = polygon[0];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; // [lon, lat] in GeoJSON
    const [xj, yj] = ring[j];
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function findParishForPoint(lat, lon) {
  for (const feature of geojson.features) {
    const name = feature.properties.shapeName;
    const slug = nameToSlug[name];
    if (!slug) continue;
    const geom = feature.geometry;
    const polygons = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
    for (const poly of polygons) {
      if (pointInPolygon(lat, lon, poly)) return slug;
    }
  }
  return null;
}

// Overpass API query categories
const queries = [
  { category: 'tourist_attraction', query: '"tourism"~"attraction|museum|gallery|viewpoint|artwork"' },
  { category: 'landmark', query: '"historic"~"monument|memorial|castle|ruins|fort"' },
  { category: 'restaurant', query: '"amenity"="restaurant"' },
  { category: 'restaurant', query: '"amenity"="fast_food"' },
  { category: 'cafe', query: '"amenity"="cafe"' },
  { category: 'hotel', query: '"tourism"~"hotel|guest_house|motel|hostel"' },
  { category: 'hospital', query: '"amenity"~"hospital|clinic"' },
  { category: 'school', query: '"amenity"~"school|university|college"' },
  { category: 'beach', query: '"natural"="beach"' },
  { category: 'place_of_worship', query: '"amenity"="place_of_worship"' },
  { category: 'bank', query: '"amenity"="bank"' },
  { category: 'gas_station', query: '"amenity"="fuel"' },
  { category: 'park', query: '"leisure"="park"' },
  { category: 'nightlife', query: '"amenity"~"bar|pub|nightclub"' },
  { category: 'shopping', query: '"shop"~"supermarket|mall|department_store|convenience"' },
];

// Jamaica bounding box
const BBOX = '17.7,-78.4,18.6,-76.1';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

async function fetchCategory(queryDef) {
  const overpassQuery = `
    [out:json][timeout:60];
    (
      node[${queryDef.query}](${BBOX});
      way[${queryDef.query}](${BBOX});
    );
    out center tags;
  `;

  console.log(`  Fetching ${queryDef.category}...`);

  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(overpassQuery),
  });

  if (!res.ok) {
    console.error(`  Failed: ${res.status} ${res.statusText}`);
    return [];
  }

  const data = await res.json();
  return data.elements || [];
}

const insertPlace = db.prepare(`
  INSERT OR IGNORE INTO places (parish_id, osm_id, name, category, lat, lon, address, phone, website, opening_hours, cuisine, stars)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const getParishId = db.prepare('SELECT id FROM parishes WHERE slug = ?');

async function main() {
  console.log('Fetching places from OpenStreetMap...\n');

  let totalInserted = 0;
  let totalSkipped = 0;

  for (const queryDef of queries) {
    const elements = await fetchCategory(queryDef);
    let inserted = 0;

    for (const el of elements) {
      const lat = el.lat || (el.center && el.center.lat);
      const lon = el.lon || (el.center && el.center.lon);
      const tags = el.tags || {};
      const name = tags.name || tags['name:en'];

      if (!lat || !lon || !name) continue;

      const slug = findParishForPoint(lat, lon);
      if (!slug) continue;

      const parish = getParishId.get(slug);
      if (!parish) continue;

      const osmId = `${el.type}/${el.id}`;
      const address = [tags['addr:street'], tags['addr:city']].filter(Boolean).join(', ') || null;

      try {
        insertPlace.run(
          parish.id,
          osmId,
          name,
          queryDef.category,
          lat,
          lon,
          address,
          tags.phone || tags['contact:phone'] || null,
          tags.website || tags['contact:website'] || null,
          tags.opening_hours || null,
          tags.cuisine || null,
          tags.stars ? parseInt(tags.stars) : null
        );
        inserted++;
      } catch (e) {
        // Duplicate osm_id, skip
      }
    }

    console.log(`  ${queryDef.category}: ${elements.length} found, ${inserted} new places inserted`);
    totalInserted += inserted;

    // Be polite to Overpass API — wait between requests
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\nDone! ${totalInserted} total places added to database.`);

  // Summary by parish
  const summary = db.prepare(`
    SELECT p.name, COUNT(pl.id) as count
    FROM parishes p LEFT JOIN places pl ON p.id = pl.parish_id
    GROUP BY p.id ORDER BY count DESC
  `).all();

  console.log('\nPlaces per parish:');
  for (const row of summary) {
    console.log(`  ${row.name}: ${row.count}`);
  }

  db.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
