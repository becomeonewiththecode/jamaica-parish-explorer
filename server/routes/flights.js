const express = require('express');
const router = express.Router();
const db = require('../db/connection');

// Load API key from environment
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';

// Jamaica airports: ICAO code, IATA code, name, lat, lon
const JAMAICA_AIRPORTS = [
  { icao: 'MKJP', iata: 'KIN', name: 'Norman Manley Intl', lat: 17.9356, lon: -76.7875 },
  { icao: 'MKJS', iata: 'MBJ', name: 'Sangster Intl', lat: 18.5037, lon: -77.9133 },
  { icao: 'MKBS', iata: 'OCJ', name: 'Ian Fleming Intl', lat: 18.4047, lon: -76.9697 },
  { icao: 'MKTP', iata: 'KTP', name: 'Tinson Pen', lat: 17.9886, lon: -76.8238 },
];

// Only query the two international airports (Ian Fleming & Tinson Pen have no scheduled flights)
const QUERIED_AIRPORTS = JAMAICA_AIRPORTS.filter(a => a.iata === 'KIN' || a.iata === 'MBJ');

// Schedule-based polling: fetch every 15 minutes (2 API calls x 4 per hour = ~192 calls/month)
const POLL_INTERVAL = 15 * 60 * 1000; // 15 minutes
const CACHE_TTL = POLL_INTERVAL;
let flightsCache = { data: null, timestamp: 0 };

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

    if (!res.ok || res.status === 204) return null;
    const data = await res.json();

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
    return null;
  }
}

// --- OpenSky fallback ---
async function fetchOpenSky() {
  try {
    const url = 'https://opensky-network.org/api/states/all?lamin=16.5&lamax=20.0&lomin=-80.0&lomax=-74.5';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'JamaicaParishExplorer/1.0' } });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.states || []).map(s => ({
      id: s[0],
      callsign: (s[1] || '').trim(),
      flightNumber: (s[1] || '').trim(),
      status: s[8] ? 'On Ground' : 'In Flight',
      type: 'live',
      from: s[2] || '',
      lat: s[6],
      lon: s[5],
      altitude: s[7],
      velocity: s[9],
      heading: s[10],
    })).filter(f => f.lat && f.lon);
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

// --- Scheduled background fetch ---
async function scheduledFetch() {
  let allFlights = [];
  let source = 'none';

  if (RAPIDAPI_KEY) {
    try {
      for (const airport of QUERIED_AIRPORTS) {
        const flights = await fetchAeroDataBox(airport);
        if (flights) allFlights.push(...flights);
        // 1.1s delay between requests to respect 1 req/sec rate limit
        if (airport !== QUERIED_AIRPORTS[QUERIED_AIRPORTS.length - 1]) {
          await new Promise(r => setTimeout(r, 1100));
        }
      }
      if (allFlights.length > 0) source = 'aerodatabox';
    } catch (e) {
      // Fall through to OpenSky
    }
  }

  // Fallback to OpenSky
  if (allFlights.length === 0) {
    const openSkyFlights = await fetchOpenSky();
    if (openSkyFlights.length > 0) {
      allFlights = openSkyFlights;
      source = 'opensky';
    }
  }

  // Store in database
  if (allFlights.length > 0 && source === 'aerodatabox') {
    storeFlights(allFlights);
  }

  const now = Date.now();
  const result = {
    flights: allFlights,
    source,
    time: Math.floor(now / 1000),
    airports: JAMAICA_AIRPORTS.map(a => ({ icao: a.icao, iata: a.iata, name: a.name, lat: a.lat, lon: a.lon })),
  };

  flightsCache = { data: result, timestamp: now };
  console.log(`[Flights] Fetched ${allFlights.length} flights from ${source} — next poll in ${POLL_INTERVAL / 60000} min`);
  return result;
}

// Start background polling on server boot
scheduledFetch();
setInterval(scheduledFetch, POLL_INTERVAL);

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
