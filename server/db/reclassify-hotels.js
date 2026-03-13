const db = require('./connection');

const rows = db.prepare("SELECT id, name, osm_id FROM places WHERE category = 'hotel'").all();
const update = db.prepare('UPDATE places SET category = ? WHERE id = ?');

const stats = { hotel: 0, guest_house: 0, resort: 0 };

async function main() {
  // Try to fetch OSM tags for accurate classification
  let tagMap = {};
  try {
    const query = `[out:json][timeout:60];
(node["tourism"~"hotel|guest_house|motel|hostel"](17.7,-78.4,18.6,-76.1);
way["tourism"~"hotel|guest_house|motel|hostel"](17.7,-78.4,18.6,-76.1););
out center tags;`;
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
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

  const txn = db.transaction(() => {
    for (const r of rows) {
      const osmTag = tagMap[r.osm_id];
      const lower = r.name.toLowerCase();
      let newCat;

      if (osmTag === 'guest_house' || osmTag === 'hostel') {
        newCat = 'guest_house';
      } else if (osmTag === 'hotel' || osmTag === 'motel') {
        if (lower.includes('resort') || lower.includes('sandals') || lower.includes('couples') || lower.includes('all-inclusive') || lower.includes('all inclusive')) {
          newCat = 'resort';
        } else {
          newCat = 'hotel';
        }
      } else {
        // No OSM match — name-based
        if (lower.includes('resort') || lower.includes('sandals') || lower.includes('couples') || lower.includes('all-inclusive') || lower.includes('all inclusive')) {
          newCat = 'resort';
        } else if (lower.includes('guest') || lower.includes('b&b') || lower.includes('bed &') || lower.includes('cottage') || lower.includes('hostel') || lower.includes('villa') || lower.includes('rooms') || lower.includes('lodge') || lower.includes('homestay')) {
          newCat = 'guest_house';
        } else {
          newCat = 'hotel';
        }
      }

      update.run(newCat, r.id);
      stats[newCat]++;
    }
  });
  txn();

  console.log('\nReclassified', rows.length, 'places:');
  console.log('  Hotels:', stats.hotel);
  console.log('  Guest Houses:', stats.guest_house);
  console.log('  Resorts:', stats.resort);
  db.close();
}

main();
