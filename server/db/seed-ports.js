const { query, closePool } = require('./pg-query');

// Inline port definitions to avoid ESM import issues from client code
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
    lon: -77.1,
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
  { id: 'falmouth-harbor', name: 'Falmouth Harbor', city: 'Falmouth', type: 'harbor', lat: 18.499, lon: -77.658 },
  {
    id: 'trelawny-marine-service',
    name: 'Trelawny Marine Service',
    city: 'Falmouth',
    type: 'marina',
    lat: 18.497,
    lon: -77.652,
  },
  {
    id: 'lagoon-hotel-marina',
    name: 'Lagoon Hotel & Marina',
    city: 'Falmouth',
    type: 'marina',
    lat: 18.494,
    lon: -77.659,
  },
  {
    id: 'caribatik-marina',
    name: 'Caribatik Marina',
    city: 'Rock Brae',
    type: 'marina',
    lat: 18.493,
    lon: -77.651,
  },
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

const UPSERT_PLACE = `
  INSERT INTO places (parish_id, osm_id, name, category, lat, lon, address, phone, website, opening_hours, cuisine, stars)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  ON CONFLICT (osm_id) DO UPDATE SET
    parish_id = EXCLUDED.parish_id,
    name = EXCLUDED.name,
    category = EXCLUDED.category,
    lat = EXCLUDED.lat,
    lon = EXCLUDED.lon,
    address = COALESCE(EXCLUDED.address, places.address),
    phone = COALESCE(EXCLUDED.phone, places.phone),
    website = COALESCE(EXCLUDED.website, places.website),
    opening_hours = COALESCE(EXCLUDED.opening_hours, places.opening_hours),
    cuisine = COALESCE(EXCLUDED.cuisine, places.cuisine),
    stars = COALESCE(EXCLUDED.stars, places.stars)
`;

async function main() {
  for (const port of PORTS) {
    const slug = portParishById[port.id];
    if (!slug) continue;
    const pr = await query('SELECT id FROM parishes WHERE slug = $1', [slug]);
    const parish = pr.rows[0];
    if (!parish) continue;

    const phone = port.phone || null;
    const website = port.website || null;

    await query(UPSERT_PLACE, [
      parish.id,
      `port/${port.id}`,
      port.name,
      'port',
      port.lat,
      port.lon,
      port.city || null,
      phone,
      website,
      null,
      null,
      null,
    ]);
  }

  console.log('Seeded cruise ports into places table (category=port).');
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
