const express = require('express');
const router = express.Router();
const db = require('../db/connection');

// Load API keys from environment
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';
const OPENSKY_CLIENT_ID = process.env.OPENSKY_CLIENT_ID || '';
const OPENSKY_CLIENT_SECRET = process.env.OPENSKY_CLIENT_SECRET || '';

// ICAO airline code → name lookup (covers Jamaica routes + major international carriers)
const ICAO_AIRLINES = {
  // Caribbean & Jamaica
  BWA: 'Caribbean Airlines', BW: 'Caribbean Airlines',
  FPO: 'Fly Jamaica Airways',
  IWD: 'InterCaribbean Airways',
  CAY: 'Cayman Airways', KX: 'Cayman Airways',
  BHS: 'Bahamasair', UP: 'Bahamasair',
  SVA: 'SVAIR', // Jamaica charter
  JMA: 'Jamaica Air Shuttle',
  TPA: 'TAPA', // Caribbean air taxi

  // US majors
  AAL: 'American Airlines', AA: 'American Airlines',
  DAL: 'Delta Air Lines', DL: 'Delta Air Lines',
  UAL: 'United Airlines', UA: 'United Airlines',
  SWA: 'Southwest Airlines', WN: 'Southwest Airlines',
  JBU: 'JetBlue Airways', B6: 'JetBlue Airways',
  NKS: 'Spirit Airlines', NK: 'Spirit Airlines',
  FFT: 'Frontier Airlines', F9: 'Frontier Airlines',
  ASA: 'Alaska Airlines', AS: 'Alaska Airlines',
  HAL: 'Hawaiian Airlines', HA: 'Hawaiian Airlines',
  ENY: 'Envoy Air', // American Eagle regional
  RPA: 'Republic Airways',
  SKW: 'SkyWest Airlines',
  PDT: 'Piedmont Airlines',
  CPZ: 'Compass Airlines',
  JIA: 'PSA Airlines',

  // Canadian
  ACA: 'Air Canada', AC: 'Air Canada',
  WJA: 'WestJet', WS: 'WestJet',
  TSC: 'Air Transat', TS: 'Air Transat',
  SWG: 'Sunwing Airlines', WG: 'Sunwing Airlines',
  ROU: 'Rouge', // Air Canada Rouge
  FLE: 'Flair Airlines', F8: 'Flair Airlines',

  // European
  BAW: 'British Airways', BA: 'British Airways',
  VIR: 'Virgin Atlantic', VS: 'Virgin Atlantic',
  DLH: 'Lufthansa', LH: 'Lufthansa',
  AFR: 'Air France', AF: 'Air France',
  KLM: 'KLM', KL: 'KLM',
  IBE: 'Iberia', IB: 'Iberia',
  SAS: 'Scandinavian Airlines', SK: 'Scandinavian Airlines',
  TAP: 'TAP Air Portugal', TP: 'TAP Air Portugal',
  AZA: 'ITA Airways', AZ: 'ITA Airways',
  SWR: 'Swiss', LX: 'Swiss',
  AUA: 'Austrian Airlines', OS: 'Austrian Airlines',
  TUI: 'TUI Airways', BY: 'TUI Airways',
  TCX: 'Thomas Cook Airlines',
  EZY: 'easyJet', U2: 'easyJet',
  RYR: 'Ryanair', FR: 'Ryanair',
  ICE: 'Icelandair', FI: 'Icelandair',
  EIN: 'Aer Lingus', EI: 'Aer Lingus',
  NOZ: 'Norwegian', DY: 'Norwegian',
  COA: 'Condor', DE: 'Condor',
  EWG: 'Eurowings', EW: 'Eurowings',

  // Latin America & Central America
  CMP: 'Copa Airlines', CM: 'Copa Airlines',
  AVA: 'Avianca', AV: 'Avianca',
  ARE: 'Aerolíneas Argentinas', AR: 'Aerolíneas Argentinas',
  TAM: 'LATAM Brasil', JJ: 'LATAM Brasil',
  LAN: 'LATAM', LA: 'LATAM',
  AMX: 'Aeroméxico', AM: 'Aeroméxico',
  VIV: 'Viva Aerobus', VB: 'Viva Aerobus',
  VOI: 'Volaris', Y4: 'Volaris',
  GLO: 'GOL', G3: 'GOL',
  AZU: 'Azul', AD: 'Azul',

  // Middle East & Asia
  UAE: 'Emirates', EK: 'Emirates',
  QTR: 'Qatar Airways', QR: 'Qatar Airways',
  ETH: 'Ethiopian Airlines', ET: 'Ethiopian Airlines',
  THY: 'Turkish Airlines', TK: 'Turkish Airlines',
  ELY: 'El Al', LY: 'El Al',
  SIA: 'Singapore Airlines', SQ: 'Singapore Airlines',
  CPA: 'Cathay Pacific', CX: 'Cathay Pacific',
  ANA: 'All Nippon Airways', NH: 'All Nippon Airways',
  JAL: 'Japan Airlines', JL: 'Japan Airlines',
  KAL: 'Korean Air', KE: 'Korean Air',
  CSN: 'China Southern', CZ: 'China Southern',
  CCA: 'Air China', CA: 'Air China',
  CES: 'China Eastern', MU: 'China Eastern',

  // Other
  QFA: 'Qantas', QF: 'Qantas',
  ANZ: 'Air New Zealand', NZ: 'Air New Zealand',
  SAA: 'South African Airways', SA: 'South African Airways',

  // Cargo (sometimes visible on radar)
  FDX: 'FedEx', FX: 'FedEx',
  UPS: 'UPS Airlines', '5X': 'UPS Airlines',
  GTI: 'Atlas Air',
  CLX: 'Cargolux', CV: 'Cargolux',
  ABW: 'AirBridgeCargo',
  DHL: 'DHL Aviation',

  // Military / Government (may appear on ADS-B)
  RCH: 'US Air Force',
  CNV: 'US Navy',
  PAT: 'Patriot Express',
  CFC: 'Canadian Forces',
  RRR: 'Royal Air Force',
};

// Extract ICAO prefix from callsign (letters before digits)
function resolveAirline(callsign) {
  if (!callsign) return '';
  const match = callsign.match(/^([A-Z]{2,4})/);
  if (!match) return '';
  const prefix = match[1];
  // Try full prefix first (3-letter ICAO), then 2-letter IATA
  return ICAO_AIRLINES[prefix] || ICAO_AIRLINES[prefix.slice(0, 3)] || ICAO_AIRLINES[prefix.slice(0, 2)] || '';
}

// OpenSky OAuth token cache
let openSkyToken = { token: null, expiresAt: 0 };

async function getOpenSkyToken() {
  const now = Date.now();
  // Return cached token if still valid (with 60s buffer)
  if (openSkyToken.token && openSkyToken.expiresAt > now + 60000) {
    return openSkyToken.token;
  }
  if (!OPENSKY_CLIENT_ID || !OPENSKY_CLIENT_SECRET) return null;

  try {
    const res = await fetch('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${OPENSKY_CLIENT_ID}&client_secret=${OPENSKY_CLIENT_SECRET}`,
    });
    if (!res.ok) return null;
    const data = await res.json();
    openSkyToken = {
      token: data.access_token,
      expiresAt: now + (data.expires_in * 1000),
    };
    console.log('[Flights] OpenSky OAuth token acquired, expires in', data.expires_in, 'seconds');
    return data.access_token;
  } catch (e) {
    console.error('[Flights] OpenSky token error:', e.message);
    return null;
  }
}

// Jamaica airports: ICAO code, IATA code, name, lat, lon
const JAMAICA_AIRPORTS = [
  { icao: 'MKJP', iata: 'KIN', name: 'Norman Manley Intl', lat: 17.9356, lon: -76.7875 },
  { icao: 'MKJS', iata: 'MBJ', name: 'Sangster Intl', lat: 18.5037, lon: -77.9133 },
  { icao: 'MKBS', iata: 'OCJ', name: 'Ian Fleming Intl', lat: 18.4047, lon: -76.9697 },
  { icao: 'MKTP', iata: 'KTP', name: 'Tinson Pen', lat: 17.9886, lon: -76.8238 },
];

// AeroDataBox: only the two international airports (have scheduled flight data)
const AERODATABOX_AIRPORTS = JAMAICA_AIRPORTS.filter(a => a.iata === 'KIN' || a.iata === 'MBJ');
// OpenSky: smaller airports with no AeroDataBox coverage
const OPENSKY_AIRPORTS = JAMAICA_AIRPORTS.filter(a => a.iata === 'OCJ' || a.iata === 'KTP');

// Separate poll intervals: scheduled flights (rate-limited API) vs live radar (free APIs)
const SCHEDULED_POLL_INTERVAL = 15 * 60 * 1000; // 15 minutes for AeroDataBox
const LIVE_POLL_INTERVAL = 30 * 1000;            // 30 seconds for adsb.lol / OpenSky
let flightsCache = { data: null, timestamp: 0 };
let cachedScheduledFlights = [];
let cachedScheduledSources = [];

// --- AeroDataBox (primary) ---
async function fetchAeroDataBox(airport) {
  if (!RAPIDAPI_KEY) return null;

  const url = `https://aerodatabox.p.rapidapi.com/flights/airports/icao/${airport.icao}?withLeg=false&direction=Both&withCancelled=false&withCodeshared=false&withCargo=false&withPrivate=false`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'x-rapidapi-host': 'aerodatabox.p.rapidapi.com',
        'x-rapidapi-key': RAPIDAPI_KEY,
      },
    });
    clearTimeout(timer);

    if (!res.ok || res.status === 204) {
      console.log(`[Flights] AeroDataBox ${airport.iata}: HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    console.log(`[Flights] AeroDataBox ${airport.iata}: ${(data.arrivals || []).length} arrivals, ${(data.departures || []).length} departures`);

    const flights = [];

    // Process arrivals
    if (data.arrivals) {
      for (const f of data.arrivals) {
        flights.push({
          id: f.number?.replace(/\s/g, '') || f.callSign || 'unknown',
          callsign: f.callSign || f.number || '',
          flightNumber: f.number || '',
          status: f.status || '',
          type: 'arrival',
          from: f.movement?.airport?.name || '',
          fromIata: f.movement?.airport?.iata || '',
          fromCountry: f.movement?.airport?.countryCode?.toUpperCase() || '',
          scheduledTime: f.movement?.scheduledTime?.local || '',
          aircraft: f.aircraft?.model || '',
          aircraftReg: f.aircraft?.reg || '',
          airline: f.airline?.name || '',
          destLat: airport.lat,
          destLon: airport.lon,
          destName: airport.name,
          destIata: airport.iata,
        });
      }
    }

    // Process departures
    if (data.departures) {
      for (const f of data.departures) {
        flights.push({
          id: f.number?.replace(/\s/g, '') || f.callSign || 'unknown',
          callsign: f.callSign || f.number || '',
          flightNumber: f.number || '',
          status: f.status || '',
          type: 'departure',
          to: f.movement?.airport?.name || '',
          toIata: f.movement?.airport?.iata || '',
          toCountry: f.movement?.airport?.countryCode?.toUpperCase() || '',
          scheduledTime: f.movement?.scheduledTime?.local || '',
          aircraft: f.aircraft?.model || '',
          aircraftReg: f.aircraft?.reg || '',
          airline: f.airline?.name || '',
          originLat: airport.lat,
          originLon: airport.lon,
          originName: airport.name,
          originIata: airport.iata,
        });
      }
    }

    return flights;
  } catch (e) {
    console.error(`[Flights] AeroDataBox ${airport.iata} error:`, e.message);
    return null;
  }
}

// --- OpenSky fallback ---
async function fetchOpenSky() {
  try {
    const token = await getOpenSkyToken();
    const url = 'https://opensky-network.org/api/states/all?lamin=16.5&lamax=20.0&lomin=-80.0&lomax=-74.5';
    const headers = { 'User-Agent': 'JamaicaParishExplorer/1.0' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { signal: controller.signal, headers });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.states || []).map(s => {
      const callsign = (s[1] || '').trim();
      return {
        id: s[0],
        callsign,
        flightNumber: callsign,
        airline: resolveAirline(callsign),
        status: s[8] ? 'On Ground' : 'In Flight',
        type: 'live',
        from: s[2] || '',
        lat: s[6],
        lon: s[5],
        altitude: s[7],
        velocity: s[9],
        heading: s[10],
      };
    }).filter(f => f.lat && f.lon);
  } catch (e) {
    return [];
  }
}

// --- OpenSky for a specific airport (nearby flights within ~25km radius) ---
async function fetchOpenSkyForAirport(airport) {
  const RADIUS = 0.25; // ~25km in degrees
  const lamin = airport.lat - RADIUS;
  const lamax = airport.lat + RADIUS;
  const lomin = airport.lon - RADIUS;
  const lomax = airport.lon + RADIUS;

  try {
    const token = await getOpenSkyToken();
    const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}`;
    const headers = { 'User-Agent': 'JamaicaParishExplorer/1.0' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { signal: controller.signal, headers });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.states || data.states.length === 0) return [];

    return data.states.map(s => {
      const lat = s[6];
      const lon = s[5];
      const altitude = s[7]; // meters
      const onGround = s[8];
      const velocity = s[9];
      const heading = s[10];
      const callsign = (s[1] || '').trim();
      const verticalRate = s[11]; // m/s, negative = descending

      // Classify: descending or on ground near airport = arrival, ascending = departure
      let direction = 'arrival';
      if (verticalRate > 1) direction = 'departure';
      else if (verticalRate < -1 || onGround) direction = 'arrival';
      else if (altitude && altitude > 3000) direction = 'arrival'; // high altitude approaching
      else direction = onGround ? 'arrival' : 'departure';

      const altFt = altitude ? Math.round(altitude * 3.281) : null;

      return {
        id: s[0] || callsign,
        callsign,
        flightNumber: callsign,
        status: onGround ? 'On Ground' : (direction === 'arrival' ? 'Approaching' : 'Departing'),
        type: direction,
        from: direction === 'arrival' ? (s[2] || 'Unknown') : '',
        fromIata: '',
        fromCountry: direction === 'arrival' ? (s[2] || '') : '',
        to: direction === 'departure' ? (s[2] || 'Unknown') : '',
        toIata: '',
        toCountry: direction === 'departure' ? (s[2] || '') : '',
        airline: resolveAirline(callsign),
        aircraft: '',
        aircraftReg: '',
        scheduledTime: '',
        lat,
        lon,
        altitude,
        velocity,
        heading,
        // Set airport references
        ...(direction === 'arrival' ? {
          destLat: airport.lat, destLon: airport.lon, destName: airport.name, destIata: airport.iata,
        } : {
          originLat: airport.lat, originLon: airport.lon, originName: airport.name, originIata: airport.iata,
        }),
      };
    }).filter(f => f.lat && f.lon);
  } catch (e) {
    return [];
  }
}

// --- adsb.lol (free, no API key — secondary for small airports) ---
async function fetchAdsbLolForAirport(airport) {
  const RADIUS_NM = 25; // nautical miles
  try {
    const url = `https://api.adsb.lol/v2/lat/${airport.lat}/lon/${airport.lon}/dist/${RADIUS_NM}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    const ac = data.ac || [];
    if (ac.length === 0) return [];

    return ac.map(a => {
      const callsign = (a.flight || '').trim();
      const altitude = a.alt_baro === 'ground' ? 0 : (a.alt_baro || 0);
      const onGround = a.alt_baro === 'ground';
      const baroRate = a.baro_rate || 0; // ft/min
      const heading = a.track || a.true_heading || 0;
      const velocity = a.gs || 0; // ground speed in knots

      // Classify by vertical rate (ft/min)
      let direction = 'arrival';
      if (baroRate > 200) direction = 'departure';
      else if (baroRate < -200 || onGround) direction = 'arrival';
      else direction = onGround ? 'arrival' : 'arrival';

      return {
        id: a.hex || callsign || 'unknown',
        callsign,
        flightNumber: callsign,
        status: onGround ? 'On Ground' : (direction === 'arrival' ? 'Approaching' : 'Departing'),
        type: direction,
        from: direction === 'arrival' ? '' : '',
        fromIata: '',
        fromCountry: '',
        to: direction === 'departure' ? '' : '',
        toIata: '',
        toCountry: '',
        airline: a.ownOp || resolveAirline(callsign),
        aircraft: a.t || '',
        aircraftReg: a.r || '',
        scheduledTime: '',
        lat: a.lat,
        lon: a.lon,
        altitude: onGround ? 0 : (altitude * 0.3048), // convert ft to meters
        velocity: velocity * 0.5144, // convert knots to m/s
        heading,
        ...(direction === 'arrival' ? {
          destLat: airport.lat, destLon: airport.lon, destName: airport.name, destIata: airport.iata,
        } : {
          originLat: airport.lat, originLon: airport.lon, originName: airport.name, originIata: airport.iata,
        }),
      };
    }).filter(f => f.lat && f.lon);
  } catch (e) {
    return [];
  }
}

// --- Store flights in database ---
function storeFlights(flights) {
  try {
    const insert = db.prepare(`
      INSERT INTO flights (flight_number, airport, status, direction, airline, aircraft, aircraft_reg, route, route_iata, route_country, scheduled_time, callsign)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMany = db.transaction((list) => {
      for (const f of list) {
        const isArrival = f.type === 'arrival';
        insert.run(
          f.flightNumber || '',
          isArrival ? (f.destIata || '') : (f.originIata || ''),
          f.status || '',
          f.type,
          f.airline || '',
          f.aircraft || '',
          f.aircraftReg || '',
          isArrival ? (f.from || '') : (f.to || ''),
          isArrival ? (f.fromIata || '') : (f.toIata || ''),
          isArrival ? (f.fromCountry || '') : (f.toCountry || ''),
          f.scheduledTime || '',
          f.callsign || ''
        );
      }
    });
    insertMany(flights);
    console.log(`[Flights] Stored ${flights.length} flights in database`);
  } catch (e) {
    console.error('[Flights] Failed to store:', e.message);
  }
}

// --- Fetch scheduled flights (AeroDataBox — rate-limited, every 15 min) ---
async function fetchScheduledFlights() {
  let flights = [];
  let sources = [];

  if (RAPIDAPI_KEY) {
    try {
      for (const airport of AERODATABOX_AIRPORTS) {
        const result = await fetchAeroDataBox(airport);
        if (result) flights.push(...result);
        if (airport !== AERODATABOX_AIRPORTS[AERODATABOX_AIRPORTS.length - 1]) {
          await new Promise(r => setTimeout(r, 1100));
        }
      }
      if (flights.length > 0) sources.push('aerodatabox');
    } catch (e) {}
  }

  // Fallback: if AeroDataBox failed, try OpenSky Jamaica-wide
  if (flights.length === 0) {
    const openSkyFlights = await fetchOpenSky();
    if (openSkyFlights.length > 0) {
      flights = openSkyFlights;
      sources.push('opensky');
    }
  }

  for (const f of flights) { f.dataSource = 'scheduled'; }
  cachedScheduledFlights = flights;
  cachedScheduledSources = sources;
  console.log(`[Flights] Scheduled: ${flights.length} flights from ${sources.join(', ') || 'none'}`);
}

// --- Fetch live radar (adsb.lol / OpenSky — free, every 30s) ---
async function fetchLiveRadar() {
  let liveFlights = [];

  for (const airport of JAMAICA_AIRPORTS) {
    let flights = [];

    // Try adsb.lol first (better Caribbean coverage, no auth needed)
    try {
      flights = await fetchAdsbLolForAirport(airport);
    } catch (e) {}

    // Fallback to OpenSky if adsb.lol returned nothing
    if (flights.length === 0) {
      try {
        flights = await fetchOpenSkyForAirport(airport);
      } catch (e) {}
    }

    if (flights.length > 0) liveFlights.push(...flights);
  }

  // Deduplicate (same aircraft may appear near multiple airports)
  const seen = new Set();
  liveFlights = liveFlights.filter(f => {
    const key = f.id + '-' + (f.destIata || f.originIata || '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  for (const f of liveFlights) { f.dataSource = 'live'; }

  // Merge with cached scheduled flights and update cache
  const allFlights = [...cachedScheduledFlights, ...liveFlights];
  const sources = [...cachedScheduledSources];
  if (liveFlights.length > 0 && !sources.includes('adsb.lol')) sources.push('adsb.lol');

  let source = 'none';
  if (sources.length === 0 && allFlights.length === 0) source = 'none';
  else if (sources.length === 1) source = sources[0];
  else source = 'mixed';

  // Store in database (only new live flights worth storing)
  const storable = liveFlights.filter(f => f.type === 'arrival' || f.type === 'departure');
  if (storable.length > 0) storeFlights(storable);

  const now = Date.now();
  flightsCache = {
    data: {
      flights: allFlights,
      source,
      time: Math.floor(now / 1000),
      airports: JAMAICA_AIRPORTS.map(a => ({ icao: a.icao, iata: a.iata, name: a.name, lat: a.lat, lon: a.lon })),
    },
    timestamp: now,
  };

  console.log(`[Flights] Live radar: ${liveFlights.length} aircraft — total ${allFlights.length} flights (source: ${source})`);
}

// Start background polling on server boot
(async () => {
  await fetchScheduledFlights();  // Get scheduled flights first
  await fetchLiveRadar();         // Then live radar
})();
setInterval(fetchScheduledFlights, SCHEDULED_POLL_INTERVAL);  // Every 15 min
setInterval(fetchLiveRadar, LIVE_POLL_INTERVAL);               // Every 30 sec

// GET /api/flights — returns cached data (never triggers an API call)
router.get('/', (req, res) => {
  if (flightsCache.data) {
    return res.json(flightsCache.data);
  }
  // First fetch hasn't completed yet
  res.json({ flights: [], source: 'loading', time: Math.floor(Date.now() / 1000), airports: JAMAICA_AIRPORTS.map(a => ({ icao: a.icao, iata: a.iata, name: a.name, lat: a.lat, lon: a.lon })) });
});

// GET /api/flights/history — query stored flight records
router.get('/history', (req, res) => {
  const { airport, direction, limit = 100 } = req.query;
  let sql = 'SELECT * FROM flights WHERE 1=1';
  const params = [];
  if (airport) { sql += ' AND airport = ?'; params.push(airport); }
  if (direction) { sql += ' AND direction = ?'; params.push(direction); }
  sql += ' ORDER BY fetched_at DESC, scheduled_time DESC LIMIT ?';
  params.push(Number(limit));
  const rows = db.prepare(sql).all(...params);
  res.json({ flights: rows, total: rows.length });
});

module.exports = router;
