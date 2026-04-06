const { query, closePool } = require('./pg-query');

const AIRPORTS_TABLE_SQL_PG = `
CREATE TABLE IF NOT EXISTS airports (
    id          BIGSERIAL PRIMARY KEY,
    code        TEXT UNIQUE NOT NULL,
    icao        TEXT NOT NULL,
    name        TEXT NOT NULL,
    short_name  TEXT NOT NULL,
    type        TEXT NOT NULL,
    lat         DOUBLE PRECISION NOT NULL,
    lon         DOUBLE PRECISION NOT NULL,
    parish_slug TEXT NOT NULL,
    named_after TEXT NOT NULL,
    opened      TEXT NOT NULL,
    elevation   TEXT NOT NULL,
    runway      TEXT NOT NULL,
    operator    TEXT NOT NULL,
    serves      TEXT NOT NULL,
    website     TEXT,
    image_url   TEXT,
    historical_facts TEXT NOT NULL
)`;

async function ensureAirportsTable() {
  await query(AIRPORTS_TABLE_SQL_PG);
}

/** @deprecated use ensureAirportsTable */
const createAirportsTable = ensureAirportsTable;

const AIRPORT_UPSERT = `
INSERT INTO airports (code, icao, name, short_name, type, lat, lon, parish_slug, named_after, opened, elevation, runway, operator, serves, website, image_url, historical_facts)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
ON CONFLICT (code) DO UPDATE SET
  icao = EXCLUDED.icao,
  name = EXCLUDED.name,
  short_name = EXCLUDED.short_name,
  type = EXCLUDED.type,
  lat = EXCLUDED.lat,
  lon = EXCLUDED.lon,
  parish_slug = EXCLUDED.parish_slug,
  named_after = EXCLUDED.named_after,
  opened = EXCLUDED.opened,
  elevation = EXCLUDED.elevation,
  runway = EXCLUDED.runway,
  operator = EXCLUDED.operator,
  serves = EXCLUDED.serves,
  website = EXCLUDED.website,
  image_url = EXCLUDED.image_url,
  historical_facts = EXCLUDED.historical_facts
`;

function airportRowParams(ap) {
  return [
    ap.code,
    ap.icao,
    ap.name,
    ap.short_name,
    ap.type,
    ap.lat,
    ap.lon,
    ap.parish_slug,
    ap.named_after,
    ap.opened,
    ap.elevation,
    ap.runway,
    ap.operator,
    ap.serves,
    ap.website ?? null,
    ap.image_url ?? null,
    ap.historical_facts,
  ];
}

/** Upsert airport rows without fetching images (for admin / Docker rebuild). */
async function seedAirportsStatic() {
  await ensureAirportsTable();
  for (const ap of AIRPORTS) {
    await query(AIRPORT_UPSERT, airportRowParams({ ...ap, image_url: null }));
  }
}

const AIRPORTS = [
  {
    code: 'KIN', icao: 'MKJP',
    name: 'Norman Manley International Airport',
    short_name: 'Norman Manley Intl',
    type: 'International Airport',
    lat: 17.9356, lon: -76.7875,
    parish_slug: 'kingston',
    named_after: "Norman Washington Manley — National Hero of Jamaica, founder of the People's National Party, and Jamaica's first Premier (1959–1962)",
    opened: 'November 27, 1948',
    elevation: '10 ft (3 m) AMSL',
    runway: 'Runway 12/30 — 2,713 m (8,901 ft), asphalt',
    operator: 'NMIA Airports Limited (managed by Grupo Aeroportuario del Pacífico)',
    serves: 'Kingston, Southeast Jamaica, Blue Mountains region',
    website: 'https://www.nmia.aero',
    historical_facts: JSON.stringify([
      'Built during World War II as a military airfield on the Palisadoes — a narrow natural sand spit extending into Kingston Harbour.',
      'Originally known as Palisadoes Airport when it opened for civilian use in 1948.',
      'Renamed in 1972 in honour of Norman Washington Manley, who led Jamaica to independence.',
      'The airport sits at the end of a 16 km causeway and is one of the most scenic approaches in the Caribbean, flanked by ocean on both sides.',
      "Handles approximately 2 million passengers annually, serving as Jamaica's primary gateway for business and government travel.",
    ]),
  },
  {
    code: 'MBJ', icao: 'MKJS',
    name: 'Sangster International Airport',
    short_name: 'Sangster Intl',
    type: 'International Airport',
    lat: 18.5037, lon: -77.9133,
    parish_slug: 'st-james',
    named_after: "Sir Donald Burns Sangster — Jamaica's second Prime Minister, who served briefly in 1967 before his untimely death",
    opened: '1947 (expanded and renamed 1975)',
    elevation: '4 ft (1 m) AMSL',
    runway: 'Runway 07/25 — 2,662 m (8,733 ft), asphalt',
    operator: 'MBJ Airports Limited (managed by Grupo Aeroportuario del Pacífico)',
    serves: 'Montego Bay, Western Jamaica, major resort areas (Negril, Ocho Rios)',
    website: 'https://www.mbjairport.com',
    historical_facts: JSON.stringify([
      "Jamaica's busiest airport, handling over 4.5 million passengers annually — more than twice the traffic of Norman Manley.",
      'Originally opened as Montego Bay Airport in 1947 to serve the growing tourism industry on the north coast.',
      'Renamed in 1975 in memory of Sir Donald Sangster, who died just weeks after becoming Prime Minister in April 1967.',
      'A major US$200 million terminal expansion was completed in 2003, transforming it into a modern gateway with duty-free shopping.',
      "Serves as the primary entry point for Jamaica's tourism industry, connecting to over 50 international destinations.",
    ]),
  },
  {
    code: 'OCJ', icao: 'MKBS',
    name: 'Ian Fleming International Airport',
    short_name: 'Ian Fleming Intl',
    type: 'Domestic / Small International Airport',
    lat: 18.4047, lon: -76.9697,
    parish_slug: 'st-mary',
    named_after: 'Ian Lancaster Fleming — British author who created James Bond while living at his GoldenEye estate in Oracabessa, St. Mary',
    opened: 'January 12, 2011 (as international; aerodrome since 1960s)',
    elevation: '90 ft (27 m) AMSL',
    runway: 'Runway 10/28 — 1,524 m (5,000 ft), asphalt',
    operator: 'Port Authority of Jamaica / IFIA Limited',
    serves: "Ocho Rios, Port Antonio, Jamaica's North-East coast",
    website: 'https://www.ianflemingairport.com',
    historical_facts: JSON.stringify([
      'Originally known as Boscobel Aerodrome, a small domestic airstrip built in the 1960s for light aircraft.',
      'Named after Ian Fleming, the creator of James Bond, who wrote all 14 Bond novels at his nearby GoldenEye estate in Oracabessa.',
      'Upgraded and officially opened as an international airport on January 12, 2011 to boost tourism to the North-East coast.',
      'Fleming lived in Jamaica from 1946 until his death in 1964, and the island featured prominently in several Bond stories including "Dr. No" and "Live and Let Die".',
      "The smallest of Jamaica's international airports, designed primarily for private jets and small charter flights.",
    ]),
  },
  {
    code: 'KTP', icao: 'MKTP',
    name: 'Tinson Pen Aerodrome',
    short_name: 'Tinson Pen',
    type: 'Domestic Aerodrome',
    lat: 17.9886, lon: -76.8238,
    parish_slug: 'kingston',
    named_after: 'Tinson Pen — a historic reclaimed peninsula in Kingston Harbour named after the Tinson family who owned the land',
    opened: "1930s (Jamaica's first commercial airport)",
    elevation: '16 ft (5 m) AMSL',
    runway: 'Runway 15/33 — 1,067 m (3,501 ft), asphalt',
    operator: 'Airports Authority of Jamaica',
    serves: 'Kingston (domestic and inter-island flights)',
    website: null,
    historical_facts: JSON.stringify([
      "Jamaica's first commercial airport, operational since the 1930s — predating Norman Manley by nearly two decades.",
      "Served as Kingston's main airport until Norman Manley International opened in 1948 on the Palisadoes.",
      'Built on reclaimed land in Kingston Harbour, the Tinson Pen area was historically used for maritime and industrial purposes.',
      'Now primarily serves domestic flights, air ambulance services, flight training, and small charter operations.',
      'Played a key role in early Caribbean aviation, connecting Jamaica to Cuba, the Cayman Islands, and other nearby territories.',
    ]),
  },
];

// Fetch og:image from a website
async function tryWebsiteImage(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const html = await res.text();

    const patterns = [
      /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
      /<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        let imageUrl = match[1];
        if (imageUrl.startsWith('/')) {
          const parsed = new URL(url);
          imageUrl = `${parsed.protocol}//${parsed.host}${imageUrl}`;
        }
        return imageUrl;
      }
    }
  } catch (e) {
    console.log(`  Website fetch failed for ${url}: ${e.message}`);
  }
  return null;
}

// Bing image search fallback
async function tryBingImage(name) {
  const query = `${name} Jamaica airport`;
  const url = 'https://www.bing.com/images/search?q=' + encodeURIComponent(query) + '&first=1';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/murl&quot;:&quot;(https?:\/\/[^&]+)/);
    return m ? m[1] : null;
  } catch (e) { return null; }
}

async function main() {
  await ensureAirportsTable();

  console.log('Seeding airports table...\n');

  for (const ap of AIRPORTS) {
    let imageUrl = null;

    // Strategy 1: og:image from airport website
    if (ap.website) {
      console.log(`  ${ap.code}: Trying website ${ap.website}...`);
      imageUrl = await tryWebsiteImage(ap.website);
      if (imageUrl) {
        console.log(`  ${ap.code}: Got website image!`);
      }
    }

    // Strategy 2: Bing image search
    if (!imageUrl) {
      console.log(`  ${ap.code}: Trying Bing image search...`);
      imageUrl = await tryBingImage(ap.name);
      if (imageUrl) {
        console.log(`  ${ap.code}: Got Bing image!`);
      }
    }

    if (!imageUrl) {
      console.log(`  ${ap.code}: No image found.`);
    }

    await query(AIRPORT_UPSERT, airportRowParams({ ...ap, image_url: imageUrl }));
    console.log(`  ${ap.code}: ${ap.name} — saved.\n`);
  }

  const { rows } = await query('SELECT code, name, image_url FROM airports ORDER BY code');
  console.log('\nAirports in database:');
  for (const r of rows) {
    console.log(`  ${r.code} — ${r.name} — image: ${r.image_url ? 'YES' : 'NO'}`);
  }

  await closePool();
}

module.exports = { AIRPORTS, createAirportsTable, ensureAirportsTable, seedAirportsStatic };

if (require.main === module) {
  main().catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
}
