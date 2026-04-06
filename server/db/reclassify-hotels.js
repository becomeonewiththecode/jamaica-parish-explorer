const { query, withTransaction, clientQuery, closePool } = require('./pg-query');

const stats = { hotel: 0, guest_house: 0, resort: 0 };

async function main() {
  const { rows } = await query("SELECT id, name, osm_id FROM places WHERE category = 'hotel'");

  let tagMap = {};
  try {
    const overpassQuery = `[out:json][timeout:60];
(node["tourism"~"hotel|guest_house|motel|hostel"](17.7,-78.4,18.6,-76.1);
way["tourism"~"hotel|guest_house|motel|hostel"](17.7,-78.4,18.6,-76.1););
out center tags;`;
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(overpassQuery),
    });
    if (res.ok) {
      const data = await res.json();
      for (const el of data.elements) {
        tagMap[el.type + '/' + el.id] = el.tags.tourism;
      }
      console.log('Loaded', Object.keys(tagMap).length, 'OSM tag mappings');
    } else {
      console.log('Overpass unavailable, using name patterns only');
    }
  } catch (e) {
    console.log('Overpass unavailable, using name patterns only');
  }

  await withTransaction(async (client) => {
    for (const r of rows) {
      const osmTag = tagMap[r.osm_id];
      const lower = r.name.toLowerCase();
      let newCat;

      if (osmTag === 'guest_house' || osmTag === 'hostel') {
        newCat = 'guest_house';
      } else if (osmTag === 'hotel' || osmTag === 'motel') {
        if (
          lower.includes('resort') ||
          lower.includes('sandals') ||
          lower.includes('couples') ||
          lower.includes('all-inclusive') ||
          lower.includes('all inclusive')
        ) {
          newCat = 'resort';
        } else {
          newCat = 'hotel';
        }
      } else {
        if (
          lower.includes('resort') ||
          lower.includes('sandals') ||
          lower.includes('couples') ||
          lower.includes('all-inclusive') ||
          lower.includes('all inclusive')
        ) {
          newCat = 'resort';
        } else if (
          lower.includes('guest') ||
          lower.includes('b&b') ||
          lower.includes('bed &') ||
          lower.includes('cottage') ||
          lower.includes('hostel') ||
          lower.includes('villa') ||
          lower.includes('rooms') ||
          lower.includes('lodge') ||
          lower.includes('homestay')
        ) {
          newCat = 'guest_house';
        } else {
          newCat = 'hotel';
        }
      }

      await clientQuery(client, 'UPDATE places SET category = $1 WHERE id = $2', [newCat, r.id]);
      stats[newCat]++;
    }
  });

  console.log('\nReclassified', rows.length, 'places:');
  console.log('  Hotels:', stats.hotel);
  console.log('  Guest Houses:', stats.guest_house);
  console.log('  Resorts:', stats.resort);
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
