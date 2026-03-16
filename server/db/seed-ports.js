const db = require('./connection');

// Inline port definitions to avoid ESM import issues from client code
const PORTS = [
  { id: 'falmouth-cruise-port', name: 'Historic Falmouth Cruise Port', city: 'Falmouth', type: 'cruise', lat: 18.49, lon: -77.65 },
  { id: 'montego-bay-cruise-port', name: 'Montego Bay Cruise Port', city: 'Montego Bay', type: 'cruise', lat: 18.47, lon: -77.92 },
  { id: 'ocho-rios-cruise-port', name: 'Ocho Rios Cruise Port', city: 'Ocho Rios', type: 'cruise', lat: 18.41, lon: -77.10 },
  { id: 'port-antonio-marina', name: 'Errol Flynn Marina', city: 'Port Antonio', type: 'cruise', lat: 18.18, lon: -76.45 },
  { id: 'kingston-harbour', name: 'Kingston Harbour / Port Royal', city: 'Kingston', type: 'cruise-cargo', lat: 17.97, lon: -76.79 },
];

const getParishId = db.prepare('SELECT id FROM parishes WHERE slug = ?');
const insertPlace = db.prepare(`
  INSERT OR IGNORE INTO places (parish_id, osm_id, name, category, lat, lon, address, phone, website, opening_hours, cuisine, stars)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const portParishById = {
  'falmouth-cruise-port': 'trelawny',
  'montego-bay-cruise-port': 'st-james',
  'ocho-rios-cruise-port': 'st-ann',
  'port-antonio-marina': 'portland',
  'kingston-harbour': 'kingston',
};

for (const port of PORTS) {
  const slug = portParishById[port.id];
  if (!slug) continue;
  const parish = getParishId.get(slug);
  if (!parish) continue;

  insertPlace.run(
    parish.id,
    `port/${port.id}`,      // synthetic osm_id namespace for ports
    port.name,
    'port',
    port.lat,
    port.lon,
    port.city || null,
    null,
    null,
    null,
    null,
    null,
  );
}

console.log('Seeded cruise ports into places table (category=port).');

