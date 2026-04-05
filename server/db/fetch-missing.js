const { query, closePool } = require('./pg-query');
const fs = require('fs');
const path = require('path');

const geojsonPath = path.join(__dirname, '..', '..', 'client', 'public', 'jamaica-parishes.geojson');
const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));

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
    if (((yi > lat) !== (yj > lat)) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
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

const BBOX = '17.7,-78.4,18.6,-76.1';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

const missing = [
  { category: 'restaurant', query: '"amenity"="restaurant"' },
  { category: 'restaurant', query: '"amenity"="fast_food"' },
  { category: 'place_of_worship', query: '"amenity"="place_of_worship"' },
  { category: 'bank', query: '"amenity"="bank"' },
  { category: 'park', query: '"leisure"="park"' },
];

const INSERT_PLACE = `
  INSERT INTO places (parish_id, osm_id, name, category, lat, lon, address, phone, website, opening_hours, cuisine, stars)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  ON CONFLICT (osm_id) DO NOTHING
`;

async function main() {
  for (const q of missing) {
    console.log(`Fetching ${q.category} (${q.query})...`);
    const overpassQuery = `[out:json][timeout:60];(node[${q.query}](${BBOX});way[${q.query}](${BBOX}););out center tags;`;
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(overpassQuery),
    });
    if (!res.ok) {
      console.log(`  Failed: ${res.status}`);
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    const data = await res.json();
    let inserted = 0;
    for (const el of data.elements || []) {
      const lat = el.lat || (el.center && el.center.lat);
      const lon = el.lon || (el.center && el.center.lon);
      const tags = el.tags || {};
      const name = tags.name || tags['name:en'];
      if (!lat || !lon || !name) continue;
      const slug = findParishForPoint(lat, lon);
      if (!slug) continue;
      const pr = await query('SELECT id FROM parishes WHERE slug = $1', [slug]);
      const parish = pr.rows[0];
      if (!parish) continue;
      const osmId = `${el.type}/${el.id}`;
      const address = [tags['addr:street'], tags['addr:city']].filter(Boolean).join(', ') || null;
      const r = await query(INSERT_PLACE, [
        parish.id,
        osmId,
        name,
        q.category,
        lat,
        lon,
        address,
        tags.phone || tags['contact:phone'] || null,
        tags.website || tags['contact:website'] || null,
        tags.opening_hours || null,
        tags.cuisine || null,
        tags.stars ? parseInt(tags.stars, 10) : null,
      ]);
      if (r.rowCount > 0) inserted++;
    }
    console.log(`  ${data.elements?.length || 0} found, ${inserted} inserted`);
    await new Promise((r) => setTimeout(r, 5000));
  }

  const tc = await query('SELECT COUNT(*)::bigint AS c FROM places');
  console.log(`\nTotal places in database: ${tc.rows[0].c}`);
  await closePool();
}

main().catch(console.error);
