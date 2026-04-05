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

const INSERT_PLACE = `
  INSERT INTO places (parish_id, osm_id, name, category, lat, lon, address, phone, website, opening_hours, cuisine, stars)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  ON CONFLICT (osm_id) DO NOTHING
`;

async function main() {
  console.log('Fetching car rental places from OpenStreetMap...\n');

  const overpassQuery = `
    [out:json][timeout:60];
    (
      node["amenity"="car_rental"](${BBOX});
      way["amenity"="car_rental"](${BBOX});
      node["shop"="car_rental"](${BBOX});
      way["shop"="car_rental"](${BBOX});
      node["name"~"rent.*car|car.*rent|vehicle.*hire",i](${BBOX});
      way["name"~"rent.*car|car.*rent|vehicle.*hire",i](${BBOX});
    );
    out center tags;
  `;

  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(overpassQuery),
  });

  if (!res.ok) {
    console.error(`Failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const data = await res.json();
  const elements = data.elements || [];
  console.log(`Found ${elements.length} car rental elements from OSM.\n`);

  let inserted = 0;
  for (const el of elements) {
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
      'car_rental',
      lat,
      lon,
      address,
      tags.phone || tags['contact:phone'] || null,
      tags.website || tags['contact:website'] || null,
      tags.opening_hours || null,
      null,
      null,
    ]);
    if (r.rowCount > 0) {
      inserted++;
      console.log(`  + ${name} (${slug})`);
    }
  }

  console.log(`\nInserted ${inserted} car rental places.`);

  console.log('\nEnriching with images...');

  const pl = await query(`
    SELECT id, name, website, category FROM places
    WHERE category = 'car_rental' AND (image_url IS NULL OR image_url = '')
  `);
  const places = pl.rows;

  if (places.length === 0) {
    console.log('All car rentals already have images.');
    await closePool();
    return;
  }

  for (const place of places) {
    let image = null;
    const q = `${place.name} Jamaica car rental`;
    const url = 'https://www.bing.com/images/search?q=' + encodeURIComponent(q) + '&first=1';
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      if (r.ok) {
        const html = await r.text();
        const m = html.match(/murl&quot;:&quot;(https?:\/\/[^&]+)/);
        if (m) image = m[1];
      }
    } catch (e) {
      /* skip */
    }

    await query('UPDATE places SET image_url = $1, description = $2 WHERE id = $3', [
      image || '',
      '',
      place.id,
    ]);
    console.log(`  ${place.name}: ${image ? 'image found' : 'no image'}`);
    await new Promise((r) => setTimeout(r, 300));
  }

  const count = await query("SELECT COUNT(*)::bigint AS c FROM places WHERE category = 'car_rental'");
  console.log(`\nTotal car rental places in DB: ${count.rows[0].c}`);
  await closePool();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
