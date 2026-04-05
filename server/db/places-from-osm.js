const fs = require('fs');
const path = require('path');

const PLACES_DDL = `
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
`;

function ensurePlacesTable(db) {
  db.exec(PLACES_DDL);
}

let _geojsonCache;
function loadGeojson() {
  if (_geojsonCache) return _geojsonCache;
  const geojsonPath = path.join(__dirname, '..', '..', 'client', 'public', 'jamaica-parishes.geojson');
  _geojsonCache = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
  return _geojsonCache;
}

const nameToSlug = {
  Hanover: 'hanover',
  Westmoreland: 'westmoreland',
  'Saint James': 'st-james',
  Trelawny: 'trelawny',
  'Saint Ann': 'st-ann',
  'Saint Elizabeth': 'st-elizabeth',
  Manchester: 'manchester',
  Clarendon: 'clarendon',
  'Saint Mary': 'st-mary',
  'Saint Catherine': 'st-catherine',
  'Saint Andrew': 'st-andrew',
  Kingston: 'kingston',
  'Saint Thomas': 'st-thomas',
  Portland: 'portland',
};

function pointInPolygon(lat, lon, polygon) {
  const ring = polygon[0];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (((yi > lat) !== (yj > lat)) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function findParishForPoint(lat, lon, geojson) {
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

const queries = [
  { category: 'tourist_attraction', query: '"tourism"~"attraction|museum|gallery|viewpoint|artwork"' },
  { category: 'landmark', query: '"historic"~"monument|memorial|castle|ruins|fort"' },
  { category: 'restaurant', query: '"amenity"="restaurant"' },
  { category: 'restaurant', query: '"amenity"="fast_food"' },
  { category: 'cafe', query: '"amenity"="cafe"' },
  { category: 'hotel', query: '"tourism"~"hotel|motel"' },
  { category: 'guest_house', query: '"tourism"~"guest_house|hostel"' },
  { category: 'hospital', query: '"amenity"~"hospital|clinic"' },
  { category: 'school', query: '"amenity"~"school|university|college"' },
  { category: 'beach', query: '"natural"="beach"' },
  { category: 'place_of_worship', query: '"amenity"="place_of_worship"' },
  { category: 'bank', query: '"amenity"="bank"' },
  { category: 'gas_station', query: '"amenity"="fuel"' },
  { category: 'park', query: '"leisure"="park"' },
  { category: 'stadium', query: '"leisure"="stadium"' },
  { category: 'stadium', query: '"leisure"="pitch"["name"]' },
  { category: 'nightlife', query: '"amenity"~"bar|pub|nightclub"' },
  { category: 'shopping', query: '"shop"~"supermarket|mall|department_store|convenience"' },
  { category: 'car_rental', query: '"amenity"="car_rental"' },
];

const BBOX = '17.7,-78.4,18.6,-76.1';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

async function fetchCategory(queryDef, onLog) {
  const overpassQuery = `
    [out:json][timeout:60];
    (
      node[${queryDef.query}](${BBOX});
      way[${queryDef.query}](${BBOX});
    );
    out center tags;
  `;

  onLog(`  Fetching ${queryDef.category}...`);

  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(overpassQuery),
  });

  if (!res.ok) {
    onLog(`  Failed: ${res.status} ${res.statusText}`);
    return [];
  }

  const data = await res.json();
  return data.elements || [];
}

/** Insert OSM POIs into places (INSERT OR IGNORE per osm_id). */
async function ingestPlacesFromOsm(db, opts = {}) {
  const onLog = opts.onLog || ((s) => console.log(s));
  const delayMs = opts.delayBetweenCategoriesMs ?? 2000;

  ensurePlacesTable(db);
  const geojson = loadGeojson();

  const insertPlace = db.prepare(`
  INSERT OR IGNORE INTO places (parish_id, osm_id, name, category, lat, lon, address, phone, website, opening_hours, cuisine, stars)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

  const getParishId = db.prepare('SELECT id FROM parishes WHERE slug = ?');

  let totalInserted = 0;

  for (const queryDef of queries) {
    const elements = await fetchCategory(queryDef, onLog);
    let inserted = 0;

    for (const el of elements) {
      const lat = el.lat || (el.center && el.center.lat);
      const lon = el.lon || (el.center && el.center.lon);
      const tags = el.tags || {};
      const name = tags.name || tags['name:en'];

      if (!lat || !lon || !name) continue;

      const slug = findParishForPoint(lat, lon, geojson);
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
          tags.stars ? parseInt(tags.stars, 10) : null
        );
        inserted++;
      } catch {
        // duplicate osm_id
      }
    }

    onLog(`  ${queryDef.category}: ${elements.length} found, ${inserted} new rows attempted`);
    totalInserted += inserted;

    await new Promise((r) => setTimeout(r, delayMs));
  }

  const totalPlaces = db.prepare('SELECT COUNT(*) as c FROM places').get().c;
  onLog(`Done. Total rows in places: ${totalPlaces} (this run attempted ~${totalInserted} inserts).`);

  return { totalInserted, categories: queries.length, totalPlaces };
}

module.exports = { ensurePlacesTable, ingestPlacesFromOsm, queries };
