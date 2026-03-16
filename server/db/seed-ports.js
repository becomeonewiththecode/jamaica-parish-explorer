const db = require('./connection');

// Inline port definitions to avoid ESM import issues from client code
// Falmouth town / harbor reference: https://marinas.com/view/harbor/n5tgd_Falmouth_Harbor_Falmouth_Jamaica
// Glistening Waters Marina reference (confirmed via multiple sources, incl. OSM-linked sites)
// e.g. https://jamaica.worldplaces.me/view-place/44923205-glistening-waters-jamaica.html
const PORTS = [
  {
    id: 'falmouth-cruise-port',
    name: 'Historic Falmouth Cruise Port',
    city: 'Falmouth',
    type: 'cruise',
    lat: 18.496,
    lon: -77.654,
    phone: '+1-876-633-2280',
    website: 'https://portoffalmouth.com/',
  },
  {
    id: 'montego-bay-cruise-port',
    name: 'Montego Bay Cruise Port',
    city: 'Montego Bay',
    type: 'cruise',
    lat: 18.47,
    lon: -77.92,
    phone: '+1-876-979-8143',
    website: 'https://portauthorityofjamaica.com/',
  },
  {
    id: 'ocho-rios-cruise-port',
    name: 'Ocho Rios Cruise Port',
    city: 'Ocho Rios',
    type: 'cruise',
    lat: 18.41,
    lon: -77.10,
    phone: '+1-876-403-5045',
    website: 'https://www.visitjamaica.com/cruises/ports/ocho-rios/',
  },
  {
    id: 'port-antonio-marina',
    name: 'Errol Flynn Marina',
    city: 'Port Antonio',
    type: 'cruise',
    lat: 18.18,
    lon: -76.45,
    phone: '+1-876-715-6044',
    website: 'https://www.errolflynnmarina.com/',
  },
  {
    id: 'kingston-harbour',
    name: 'Kingston Harbour / Port Royal',
    city: 'Kingston',
    type: 'cruise-cargo',
    lat: 17.97,
    lon: -76.79,
    phone: null,
    website: 'https://www.kingstonwharves.com/',
  },
  // Falmouth Harbor and nearby marinas
  // - Falmouth town center / harbor approximate: 18.4936, -77.6559
  // - Icons are slightly offset and nudged offshore so they appear in water at close zoom
  // - Glistening Waters Marina: 18.48302, -77.62841
  { id: 'falmouth-harbor', name: 'Falmouth Harbor', city: 'Falmouth', type: 'harbor', lat: 18.499, lon: -77.658 },
  { id: 'trelawny-marine-service', name: 'Trelawny Marine Service', city: 'Falmouth', type: 'marina', lat: 18.497, lon: -77.652 },
  { id: 'lagoon-hotel-marina', name: 'Lagoon Hotel & Marina', city: 'Falmouth', type: 'marina', lat: 18.494, lon: -77.659 },
  { id: 'caribatik-marina', name: 'Caribatik Marina', city: 'Rock Brae', type: 'marina', lat: 18.493, lon: -77.651 },
  {
    id: 'glistening-waters-marina',
    name: 'Glistening Waters Marina',
    city: 'Falmouth',
    type: 'marina',
    lat: 18.48302,
    lon: -77.62841,
    phone: '+1-876-954-3229',
    website: 'https://www.glisteningwaters.com/marina/',
  },
];

const getParishId = db.prepare('SELECT id FROM parishes WHERE slug = ?');
const insertPlace = db.prepare(`
  INSERT INTO places (parish_id, osm_id, name, category, lat, lon, address, phone, website, opening_hours, cuisine, stars)
  VALUES (@parish_id, @osm_id, @name, @category, @lat, @lon, @address, @phone, @website, @opening_hours, @cuisine, @stars)
  ON CONFLICT(osm_id) DO UPDATE SET
    parish_id = excluded.parish_id,
    name = excluded.name,
    category = excluded.category,
    lat = excluded.lat,
    lon = excluded.lon,
    address = COALESCE(excluded.address, places.address),
    phone = COALESCE(excluded.phone, places.phone),
    website = COALESCE(excluded.website, places.website),
    opening_hours = COALESCE(excluded.opening_hours, places.opening_hours),
    cuisine = COALESCE(excluded.cuisine, places.cuisine),
    stars = COALESCE(excluded.stars, places.stars)
`);

const portParishById = {
  'falmouth-cruise-port': 'trelawny',
  'montego-bay-cruise-port': 'st-james',
  'ocho-rios-cruise-port': 'st-ann',
  'port-antonio-marina': 'portland',
  'kingston-harbour': 'kingston',
  'falmouth-harbor': 'trelawny',
  'trelawny-marine-service': 'trelawny',
  'lagoon-hotel-marina': 'trelawny',
  'caribatik-marina': 'trelawny',
  'glistening-waters-marina': 'trelawny',
};

for (const port of PORTS) {
  const slug = portParishById[port.id];
  if (!slug) continue;
  const parish = getParishId.get(slug);
  if (!parish) continue;

  const phone = port.phone || null;
  const website = port.website || null;

  insertPlace.run({
    parish_id: parish.id,
    osm_id: `port/${port.id}`,      // synthetic osm_id namespace for ports
    name: port.name,
    category: 'port',
    lat: port.lat,
    lon: port.lon,
    address: port.city || null,
    phone,
    website,
    opening_hours: null,
    cuisine: null,
    stars: null,
  });
}

console.log('Seeded cruise ports into places table (category=port).');

