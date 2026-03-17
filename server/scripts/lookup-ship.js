#!/usr/bin/env node
/**
 * Look up a ship by name in the AIS vessel feed and report position relative to a Jamaican port.
 * Usage: node server/scripts/lookup-ship.js [shipName] [portId]
 * Example: node server/scripts/lookup-ship.js "Adventure of the Seas" falmouth-cruise-port
 *
 * Requires server running (npm run dev or node server/index.js) and AISSTREAM_API_KEY in server/.env.
 */

const BASE = process.env.API_BASE || 'http://localhost:3001';
const SHIP_NAME = process.argv[2] || 'Adventure of the Seas';
const PORT_ID = process.argv[3] || 'falmouth-cruise-port';

const PORTS = {
  'falmouth-cruise-port':   { name: 'Historic Falmouth Cruise Port', lat: 18.496, lon: -77.654 },
  'montego-bay-cruise-port': { name: 'Montego Bay Cruise Port',      lat: 18.47,  lon: -77.92 },
  'ocho-rios-cruise-port':  { name: 'Ocho Rios Cruise Port',        lat: 18.41,  lon: -77.10 },
};

function distKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * 111;
  const dLon = (lon2 - lon1) * 111 * Math.cos((lat1 * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

async function main() {
  const port = PORTS[PORT_ID];
  if (!port) {
    console.error('Unknown port:', PORT_ID);
    console.error('Known ports:', Object.keys(PORTS).join(', '));
    process.exit(1);
  }

  console.log(`Looking for ship matching: "${SHIP_NAME}"`);
  console.log(`Reference port: ${port.name} (${port.lat}, ${port.lon})\n`);

  let data;
  try {
    const res = await fetch(`${BASE}/api/vessels`);
    if (!res.ok) {
      console.error('API error:', res.status, res.statusText);
      process.exit(1);
    }
    data = await res.json();
  } catch (err) {
    if (err.cause?.code === 'ECONNREFUSED') {
      console.error('Cannot reach API at', BASE);
      console.error('Start the server first: cd server && node index.js (or npm run dev from project root)');
    } else {
      console.error('Fetch error:', err.message);
    }
    process.exit(1);
  }

  const vessels = data.vessels || [];
  const needle = SHIP_NAME.toLowerCase();
  const matches = vessels.filter((v) => (v.name || '').toLowerCase().includes(needle));

  if (matches.length === 0) {
    console.log('Vessel not found in current AIS feed.');
    console.log('Total vessels in Jamaica bounding box:', vessels.length);
    if (vessels.length === 0) {
      console.log('\nPossible reasons: AISSTREAM_API_KEY not set, or no ships currently in the Jamaica area.');
    } else {
      console.log('\nCruise-like vessels (name/type):');
      const cruise = vessels.filter((v) => {
        const n = (v.name || '').toLowerCase();
        const t = (v.shipType || '').toLowerCase();
        return t.includes('passenger') || n.includes('carnival') || n.includes('royal') || n.includes('msc') || n.includes('norwegian') || n.includes('cruise');
      });
      cruise.slice(0, 15).forEach((v) => console.log('  -', v.name || `MMSI ${v.mmsi}`, v.shipType || ''));
    }
    return;
  }

  const time = data.time ? new Date(data.time * 1000).toISOString() : 'unknown';
  console.log(`AIS snapshot time: ${time}\n`);

  for (const v of matches) {
    const d = distKm(v.lat, v.lon, port.lat, port.lon);
    const inPort = d <= 3 ? 'YES (within 3 km)' : 'NO';
    console.log('---');
    console.log('Name:    ', v.name || `MMSI ${v.mmsi}`);
    console.log('Type:    ', v.shipType || '—');
    console.log('MMSI:    ', v.mmsi);
    console.log('Position:', v.lat, v.lon);
    console.log('Speed:   ', v.sog != null ? `${v.sog.toFixed(1)} kn` : '—');
    console.log('Heading: ', v.heading != null ? `${v.heading}°` : '—');
    console.log('Distance to', port.name + ':', d.toFixed(2), 'km');
    console.log('In port (≤3 km):', inPort);
  }
}

main();
