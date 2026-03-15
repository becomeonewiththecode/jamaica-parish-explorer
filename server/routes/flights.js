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
  LAE: 'Línea Aérea de Servicio Ejecutivo',

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

// ICAO → { name, iata } for route display (Jamaica + common international)
const ICAO_AIRPORT_LOOKUP = new Map([
  ...JAMAICA_AIRPORTS.map(a => [a.icao, { name: a.name, iata: a.iata }]),
  // US
  ['KJFK', { name: 'New York JFK', iata: 'JFK' }], ['KMIA', { name: 'Miami Intl', iata: 'MIA' }],
  ['KATL', { name: 'Atlanta Hartsfield', iata: 'ATL' }], ['KLAX', { name: 'Los Angeles Intl', iata: 'LAX' }],
  ['KORD', { name: 'Chicago O\'Hare', iata: 'ORD' }], ['KDFW', { name: 'Dallas/Fort Worth', iata: 'DFW' }],
  ['KEWR', { name: 'Newark', iata: 'EWR' }], ['KLGA', { name: 'LaGuardia', iata: 'LGA' }],
  ['KSFO', { name: 'San Francisco', iata: 'SFO' }], ['KBOS', { name: 'Boston Logan', iata: 'BOS' }],
  ['KPHL', { name: 'Philadelphia', iata: 'PHL' }], ['KCLT', { name: 'Charlotte', iata: 'CLT' }],
  ['KIAH', { name: 'Houston Bush', iata: 'IAH' }], ['KMCO', { name: 'Orlando', iata: 'MCO' }],
  ['KTPA', { name: 'Tampa', iata: 'TPA' }], ['KFLL', { name: 'Fort Lauderdale', iata: 'FLL' }],
  // Caribbean
  ['TNCM', { name: 'St Maarten', iata: 'SXM' }], ['TAPA', { name: 'Antigua', iata: 'ANU' }],
  ['TBPB', { name: 'Barbados', iata: 'BGI' }], ['TNCC', { name: 'Curaçao', iata: 'CUR' }],
  ['MDPP', { name: 'Punta Cana', iata: 'PUJ' }], ['MDSD', { name: 'Santo Domingo', iata: 'SDQ' }],
  // Canada
  ['CYYZ', { name: 'Toronto Pearson', iata: 'YYZ' }], ['CYVR', { name: 'Vancouver', iata: 'YVR' }],
  ['CYUL', { name: 'Montreal', iata: 'YUL' }],
  // UK / Europe
  ['EGLL', { name: 'London Heathrow', iata: 'LHR' }], ['EGGW', { name: 'London Luton', iata: 'LTN' }],
  ['LFPG', { name: 'Paris CDG', iata: 'CDG' }], ['LEMD', { name: 'Madrid', iata: 'MAD' }],
  ['EDDF', { name: 'Frankfurt', iata: 'FRA' }], ['EHAM', { name: 'Amsterdam', iata: 'AMS' }],
  ['LIRF', { name: 'Rome Fiumicino', iata: 'FCO' }], ['LEMD', { name: 'Madrid', iata: 'MAD' }],
  // Central / South America
  ['MMMX', { name: 'Mexico City', iata: 'MEX' }], ['SKBO', { name: 'Bogotá', iata: 'BOG' }],
  ['SPIM', { name: 'Lima', iata: 'LIM' }], ['SBGR', { name: 'São Paulo Guarulhos', iata: 'GRU' }],
  ['SCEL', { name: 'Santiago', iata: 'SCL' }], ['MPMG', { name: 'Panama City', iata: 'PTY' }],
]);

function resolveAirportByIcao(icao) {
  if (!icao) return null;
  const upper = String(icao).toUpperCase();
  return ICAO_AIRPORT_LOOKUP.get(upper) || { name: upper, iata: upper };
}

// AeroDataBox: only the two international airports (have scheduled flight data)
const AERODATABOX_AIRPORTS = JAMAICA_AIRPORTS.filter(a => a.iata === 'KIN' || a.iata === 'MBJ');
// OpenSky: smaller airports with no AeroDataBox coverage
const OPENSKY_AIRPORTS = JAMAICA_AIRPORTS.filter(a => a.iata === 'OCJ' || a.iata === 'KTP');

// Jamaica ICAO codes for route cross-referencing
const JAMAICA_ICAOS = new Set(JAMAICA_AIRPORTS.map(a => a.icao));
const JAMAICA_IATAS = new Set(JAMAICA_AIRPORTS.map(a => a.iata));

// Separate poll intervals: scheduled flights (rate-limited API) vs live radar (free APIs)
const SCHEDULED_POLL_INTERVAL = 15 * 60 * 1000; // 15 minutes for AeroDataBox
const LIVE_POLL_INTERVAL = 30 * 1000;            // 30 seconds — adsb.lol + OpenSky polled this often for all Jamaica
let flightsCache = { data: null, timestamp: 0 };
let cachedScheduledFlights = [];
let cachedScheduledSources = [];
// Per-airport cache: when AeroDataBox returns 429 for one airport, keep showing last good data for that airport
let cachedScheduledByAirport = {};

// --- Route lookup cache (callsign → { origin, destination } ICAO codes) ---
// TTL: 2 hours (routes don't change mid-flight)
const routeCache = new Map();
const ROUTE_CACHE_TTL = 2 * 60 * 60 * 1000;

// Normalize callsign for cache/API (OpenSky expects no spaces, e.g. "UPS1234")
function normalizeCallsign(callsign) {
  return (callsign || '').replace(/\s/g, '').trim() || null;
}

// ICAO (3-letter) ↔ IATA (2-letter) designators so scheduled "DL1997" matches live "DAL1997"
const CALLSIGN_EQUIVALENTS = { DAL: 'DL', UAL: 'UA', AAL: 'AA', SWA: 'WN', JBU: 'B6', NKS: 'NK', FFT: 'F9', ASA: 'AS', GJS: 'G4', SCX: 'SY', RPA: 'RP', EDV: '9E', SKW: 'OO', ENY: 'MQ', JIA: '3L', LOBO: 'L5' };

function getCallsignMatchKeys(callsign) {
  const cs = (callsign || '').replace(/\s/g, '').trim().toUpperCase();
  if (!cs) return [];
  const keys = [cs];
  const three = cs.slice(0, 3);
  const two = cs.slice(0, 2);
  const rest = cs.slice(3) || cs.slice(2);
  if (CALLSIGN_EQUIVALENTS[three] && rest) keys.push(CALLSIGN_EQUIVALENTS[three] + rest);
  const twoToThree = Object.entries(CALLSIGN_EQUIVALENTS).find(([, iata]) => iata === two);
  if (twoToThree && rest) keys.push(twoToThree[0] + rest);
  return [...new Set(keys)];
}

// Store route in cache under both callsign and icao24 so lookup by either key finds it
function setRouteCache(callsign, icao24, entry) {
  const ncs = normalizeCallsign(callsign);
  if (ncs) routeCache.set(ncs, entry);
  if (icao24) routeCache.set(icao24, entry);
}

// OpenSky route lookup: tries /routes (callsign→typical route), then /flights/aircraft (icao24→current flight route)
async function lookupRoute(callsign, icao24) {
  const ncs = normalizeCallsign(callsign);
  if (!ncs && !icao24) return null;
  const cacheKey = ncs || icao24;
  const cached = routeCache.get(cacheKey);
  if (cached && Date.now() - cached.time < ROUTE_CACHE_TTL) return cached.route;

  const token = await getOpenSkyToken();
  const headers = { 'User-Agent': 'JamaicaParishExplorer/1.0' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // Strategy 1: /routes?callsign=X — fast, maps callsign to typical airport pair (often missing for cargo)
  if (ncs) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`https://opensky-network.org/api/routes?callsign=${encodeURIComponent(ncs)}`, {
        signal: controller.signal, headers,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        const route = data.route || [];
        if (route.length >= 2) {
          const result = { origin: route[0], destination: route[route.length - 1], source: 'routes' };
          const entry = { route: result, time: Date.now() };
          setRouteCache(callsign, icao24, entry);
          console.log(`[Flights] Route lookup ${ncs}: ${result.origin} → ${result.destination} (via /routes)`);
          return result;
        }
      }
    } catch (e) {}
  }

  // Strategy 2: /flights/aircraft?icao24=X — returns departure/arrival for recent flights (best for cargo/live)
  if (icao24) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const begin = now - 21600; // last 6 hours (cargo/long-haul may be en route longer)
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(
        `https://opensky-network.org/api/flights/aircraft?icao24=${encodeURIComponent(icao24)}&begin=${begin}&end=${now}`,
        { signal: controller.signal, headers }
      );
      clearTimeout(timer);
      if (res.ok) {
        const flights = await res.json();
        // Get the most recent flight (last in array or the one still in progress)
        const current = flights.length > 0 ? flights[flights.length - 1] : null;
        if (current && (current.estDepartureAirport || current.estArrivalAirport)) {
          const result = {
            origin: current.estDepartureAirport || null,
            destination: current.estArrivalAirport || null,
            source: 'flights/aircraft',
          };
          const entry = { route: result, time: Date.now() };
          setRouteCache(callsign, icao24, entry);
          console.log(`[Flights] Route lookup ${ncs || icao24}: ${result.origin || '?'} → ${result.destination || '?'} (via /flights/aircraft)`);
          return result;
        }
      }
    } catch (e) {}
  }

  // Cache miss — store under both keys so we don't re-request
  const missEntry = { route: null, time: Date.now() };
  setRouteCache(callsign, icao24, missEntry);
  return null;
}

// Primary route source: adsb.lol routeset API (POST /api/0/routeset). Same source as the adsb.lol website route panel.
async function fetchRoutesFromAdsbLolRouteset(flights) {
  const needRoute = flights.filter(f => {
    const ncs = normalizeCallsign(f.callsign);
    if (!ncs || (f.lat == null || f.lon == null)) return false;
    if (routeCache.has(ncs) || routeCache.has(f.id)) return false;
    if (f.routeSource === 'adsb.lol' && f.routeOrigin && f.routeDestination) return false;
    return true;
  });
  if (needRoute.length === 0) return;
  const batch = needRoute.slice(0, 30).map(f => ({
    callsign: normalizeCallsign(f.callsign),
    lat: Number(f.lat),
    lng: Number(f.lon),
  })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (batch.length === 0) return;
  try {
    const res = await fetch('https://api.adsb.lol/api/0/routeset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'JamaicaParishExplorer/1.0' },
      body: JSON.stringify({ planes: batch }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data)) return;
    for (const item of data) {
      const callsign = (item.callsign || '').toString().replace(/\s/g, '');
      // Prefer ICAO so reclassification (JAMAICA_ICAOS) works when destination is MKJS/MBJ
      const routeStr = (item.airport_codes_icao || item.airport_codes || '').toString().trim();
      const match = routeStr.match(/^([A-Z0-9]{3,4})\-([A-Z0-9]{3,4})$/i);
      if (callsign && match) {
        const origin = match[1].toUpperCase();
        const destination = match[2].toUpperCase();
        const route = { origin, destination, source: 'adsb.lol' };
        const entry = { route, time: Date.now() };
        setRouteCache(callsign, null, entry);
        console.log(`[Flights] Route ${callsign}: ${origin} → ${destination} (adsb.lol routeset)`);
      }
    }
  } catch (e) {
    // ignore
  }
}

// Fallback route lookup when OpenSky/adsb.lol routeset miss. Uses hexdb.io route-by-callsign.
async function lookupRouteFallback(callsign, icao24) {
  const ncs = normalizeCallsign(callsign);
  if (!ncs) return null;
  const cached = routeCache.get(ncs) || routeCache.get(icao24);
  if (cached && Date.now() - cached.time < ROUTE_CACHE_TTL) return cached.route;

  try {
    const res = await fetch(`https://hexdb.io/api/v1/route/icao/${encodeURIComponent(ncs)}`, {
      headers: { 'User-Agent': 'JamaicaParishExplorer/1.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      setRouteCache(callsign, icao24, { route: null, time: Date.now() });
      return null;
    }
    const data = await res.json();
    const routeStr = (data.route || data.departure_arrival || '').toString().trim();
    const match = routeStr.match(/^([A-Z0-9]{3,4})[\s\-–—]+([A-Z0-9]{3,4})$/i);
    if (match) {
      const origin = match[1].toUpperCase();
      const destination = match[2].toUpperCase();
      const result = { origin, destination, source: 'hexdb' };
      setRouteCache(callsign, icao24, { route: result, time: Date.now() });
      console.log(`[Flights] Route fallback ${ncs}: ${origin} → ${destination} (hexdb.io)`);
      return result;
    }
  } catch (e) {
    // ignore
  }
  setRouteCache(callsign, icao24, { route: null, time: Date.now() });
  return null;
}

// Batch route lookup for multiple flights (with rate limiting). Try every flight that needs route so routes show consistently.
async function enrichFlightsWithRoutes(flights) {
  const hasCachedRoute = (f) => routeCache.has(normalizeCallsign(f.callsign)) || routeCache.has(f.id);
  const hasRouteFromAdsbLol = (f) => f.routeSource === 'adsb.lol' && f.routeOrigin && f.routeDestination;
  const toEnrich = flights.filter(f => (f.callsign || f.id) && !hasCachedRoute(f) && !hasRouteFromAdsbLol(f));

  // 1) Primary: adsb.lol routeset API (same source as https://adsb.lol route panel) — batch POST, one request per cycle
  await fetchRoutesFromAdsbLolRouteset(flights);

  // 2) OpenSky for any still missing route (rate-limited)
  const stillNeedRoute = flights.filter(f => !hasCachedRoute(f) && !hasRouteFromAdsbLol(f));
  const flyoversFirst = [...stillNeedRoute.filter(f => f.type === 'flyover'), ...stillNeedRoute.filter(f => f.type !== 'flyover')];
  const openSkyCap = 40; // ~9s at 220ms each
  for (let i = 0; i < Math.min(flyoversFirst.length, openSkyCap); i++) {
    const f = flyoversFirst[i];
    await lookupRoute(f.callsign, f.id);
    await new Promise(r => setTimeout(r, 220)); // OpenSky rate limit
  }

  // Also try matching callsigns against cached scheduled flights (AeroDataBox)
  const scheduledByCallsign = new Map();
  for (const sf of cachedScheduledFlights) {
    const cs = (sf.callsign || sf.flightNumber || '').replace(/\s/g, '');
    if (cs) scheduledByCallsign.set(cs, sf);
  }

  // Fallback: try hexdb.io for flights still missing route (skip when adsb.lol already provided route).
  const needFallback = flights.filter(f => {
    if (hasRouteFromAdsbLol(f)) return false;
    const ncs = normalizeCallsign(f.callsign);
    if (!ncs) return false;
    const cached = routeCache.get(ncs) || routeCache.get(f.id);
    if (cached?.route) return false;
    if (scheduledByCallsign.get(ncs)) return false;
    return true;
  });
  const fallbackCap = 40; // ~11s at 280ms each
  for (let i = 0; i < Math.min(needFallback.length, fallbackCap); i++) {
    const f = needFallback[i];
    await lookupRouteFallback(f.callsign, f.id);
    await new Promise(r => setTimeout(r, 280)); // hexdb rate limit
  }

  // Apply route data to flights. Prefer adsb.lol when present (more reliable); only use OpenSky/hexdb when adsb.lol didn't provide route.
  for (const f of flights) {
    const hasRouteFromAdsbLol = f.routeSource === 'adsb.lol' && f.routeOrigin && f.routeDestination;
    if (hasRouteFromAdsbLol) continue; // keep adsb.lol route, do not overwrite

    const cached = routeCache.get(normalizeCallsign(f.callsign)) || routeCache.get(f.id);
    const route = cached?.route;

    // 2. Try matching against AeroDataBox scheduled data (normalize callsign for match)
    const scheduled = scheduledByCallsign.get(normalizeCallsign(f.callsign));

    if (route) {
      f.routeOrigin = route.origin;      // ICAO code (e.g., "KJFK")
      f.routeDestination = route.destination; // ICAO code (e.g., "SBGL")
      if (route.source) f.routeSource = route.source; // e.g. 'adsb.lol' from routeset

      // If destination is a Jamaica airport but we classified as flyover, reclassify (support both ICAO and IATA from routeset)
      const destJamaica = JAMAICA_AIRPORTS.find(a => a.icao === route.destination || a.iata === route.destination);
      if (f.type === 'flyover' && destJamaica) {
        f.type = 'arrival';
        f.status = 'Approaching';
        f.destLat = destJamaica.lat;
        f.destLon = destJamaica.lon;
        f.destName = destJamaica.name;
        f.destIata = destJamaica.iata;
        f.nearestAirport = destJamaica.iata;
        console.log(`[Flights] Reclassified ${f.callsign} from flyover → arrival at ${destJamaica.name} (route: ${route.origin}→${route.destination})`);
      }

      // If origin is a Jamaica airport but we classified as flyover, reclassify (support both ICAO and IATA)
      const origJamaica = JAMAICA_AIRPORTS.find(a => a.icao === route.origin || a.iata === route.origin);
      if (f.type === 'flyover' && origJamaica) {
        f.type = 'departure';
        f.status = 'Departing';
        f.originLat = origJamaica.lat;
        f.originLon = origJamaica.lon;
        f.originName = origJamaica.name;
        f.originIata = origJamaica.iata;
        f.nearestAirport = origJamaica.iata;
        console.log(`[Flights] Reclassified ${f.callsign} from flyover → departure from ${origJamaica.name} (route: ${route.origin}→${route.destination})`);
      }

      // For remaining flyovers, add full route + origin/destination airport info
      if (f.type === 'flyover') {
        f.routeOrigin = route.origin;
        f.routeDestination = route.destination;
        if (route.origin) {
          const orig = resolveAirportByIcao(route.origin);
          f.from = orig.name;
          f.fromIata = orig.iata;
          f.originName = orig.name;
          f.originIata = orig.iata;
        }
        if (route.destination) {
          const dest = resolveAirportByIcao(route.destination);
          f.to = dest.name;
          f.toIata = dest.iata;
          f.destName = dest.name;
          f.destIata = dest.iata;
        }
        // Confirmed flyover if: destination exists and is NOT Jamaica, OR origin is NOT Jamaica (departed elsewhere, not arriving here)
        const destNotJamaica = route.destination && !JAMAICA_ICAOS.has(route.destination) && !JAMAICA_IATAS.has(route.destination);
        const originNotJamaica = route.origin && !JAMAICA_ICAOS.has(route.origin) && !JAMAICA_IATAS.has(route.origin);
        if (destNotJamaica || (originNotJamaica && !route.destination)) {
          f.confirmedFlyover = true;
        }
      }
    }

    // Supplement with AeroDataBox schedule match if no OpenSky route
    if (!route && scheduled) {
      if (f.type === 'flyover') {
        // Scheduled data confirms this flight is Jamaica-bound
        if (scheduled.type === 'arrival' && scheduled.destIata) {
          const destAirport = JAMAICA_AIRPORTS.find(a => a.iata === scheduled.destIata);
          if (destAirport) {
            f.type = 'arrival';
            f.status = 'Approaching';
            f.destLat = destAirport.lat;
            f.destLon = destAirport.lon;
            f.destName = destAirport.name;
            f.destIata = destAirport.iata;
            f.nearestAirport = destAirport.iata;
            f.from = scheduled.from;
            f.fromIata = scheduled.fromIata;
            console.log(`[Flights] Reclassified ${f.callsign} from flyover → arrival (matched schedule: ${scheduled.from} → ${destAirport.name})`);
          }
        } else if (scheduled.type === 'departure' && scheduled.originIata) {
          const origAirport = JAMAICA_AIRPORTS.find(a => a.iata === scheduled.originIata);
          if (origAirport) {
            f.type = 'departure';
            f.status = 'Departing';
            f.originLat = origAirport.lat;
            f.originLon = origAirport.lon;
            f.originName = origAirport.name;
            f.originIata = origAirport.iata;
            f.nearestAirport = origAirport.iata;
            f.to = scheduled.to;
            f.toIata = scheduled.toIata;
            console.log(`[Flights] Reclassified ${f.callsign} from flyover → departure (matched schedule: ${origAirport.name} → ${scheduled.to})`);
          }
        }
      }
      // Even for non-flyovers, add route info from schedule (only when we don't already have route from adsb.lol)
      if (!hasRouteFromAdsbLol && !f.routeOrigin && scheduled.fromIata) f.routeOrigin = scheduled.fromIata;
      if (!hasRouteFromAdsbLol && !f.routeDestination && scheduled.toIata) f.routeDestination = scheduled.toIata;
    }
  }

  return flights;
}

// --- AeroDataBox (primary) ---
// Returns { flights, status } so caller can retry on 429. flights is null on failure; status is HTTP status when failed.
async function fetchAeroDataBox(airport) {
  if (!RAPIDAPI_KEY) return { flights: null, status: 0 };

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
      return { flights: null, status: res.status };
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

    return { flights, status: res.status };
  } catch (e) {
    console.error(`[Flights] AeroDataBox ${airport.iata} error:`, e.message);
    return { flights: null, status: 0 };
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

      // Distance from airport (rough nm)
      const distNm = Math.hypot((lat - airport.lat) * 60, (lon - airport.lon) * 60 * Math.cos(airport.lat * Math.PI / 180));
      const altFt = altitude ? altitude * 3.281 : 0;
      const { direction, status } = classifyLiveFlight({ onGround, altFt, verticalRateMps: verticalRate, distNm });

      return {
        id: s[0] || callsign,
        callsign,
        flightNumber: callsign,
        status,
        type: direction,
        from: s[2] || '',
        fromIata: '',
        fromCountry: s[2] || '',
        to: '',
        toIata: '',
        toCountry: '',
        airline: resolveAirline(callsign),
        aircraft: '',
        aircraftReg: '',
        scheduledTime: '',
        lat,
        lon,
        altitude,
        velocity,
        heading,
        nearestAirport: airport.iata,
        ...(direction === 'arrival' ? {
          destLat: airport.lat, destLon: airport.lon, destName: airport.name, destIata: airport.iata,
        } : direction === 'departure' ? {
          originLat: airport.lat, originLon: airport.lon, originName: airport.name, originIata: airport.iata,
        } : {}),
      };
    }).filter(f => f.lat && f.lon);
  } catch (e) {
    return [];
  }
}

// OpenSky Jamaica-wide: all aircraft in bounding box (captures flyovers like UPS359 that adsb.lol public API may not return)
async function fetchOpenSkyJamaicaWide() {
  const lamin = 16.5;
  const lamax = 20.0;
  const lomin = -80.0;
  const lomax = -74.5;
  try {
    const token = await getOpenSkyToken();
    const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}`;
    const headers = { 'User-Agent': 'JamaicaParishExplorer/1.0' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, { signal: controller.signal, headers });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.states || data.states.length === 0) return [];

    return data.states.map(s => {
      const lat = s[6];
      const lon = s[5];
      if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const altitude = s[7]; // meters
      const onGround = s[8];
      const velocity = s[9];
      const heading = s[10];
      const callsign = (s[1] || '').trim();
      const verticalRate = s[11];
      const altFt = altitude ? altitude * 3.281 : 0;

      let nearest = JAMAICA_AIRPORTS[0];
      let minDist = Infinity;
      for (const ap of JAMAICA_AIRPORTS) {
        const d = Math.hypot((lat - ap.lat) * 60, (lon - ap.lon) * 60 * Math.cos(ap.lat * Math.PI / 180));
        if (d < minDist) { minDist = d; nearest = ap; }
      }

      const { direction, status } = classifyLiveFlight({ onGround, altFt, verticalRateMps: verticalRate, distNm: minDist });

      return {
        id: s[0] || (callsign && callsign.replace(/\s/g, '')) || 'unknown',
        callsign,
        flightNumber: callsign,
        status,
        type: direction,
        from: '',
        fromIata: '',
        to: '',
        toIata: '',
        airline: resolveAirline(callsign),
        aircraft: '',
        aircraftReg: '',
        scheduledTime: '',
        lat,
        lon,
        altitude: altitude != null ? altitude : undefined,
        velocity: velocity != null ? velocity : undefined,
        heading: heading != null ? heading : 0,
        nearestAirport: nearest.iata,
        ...(direction === 'arrival' ? {
          destLat: nearest.lat, destLon: nearest.lon, destName: nearest.name, destIata: nearest.iata,
        } : direction === 'departure' ? {
          originLat: nearest.lat, originLon: nearest.lon, originName: nearest.name, originIata: nearest.iata,
        } : {}),
      };
    }).filter(f => f != null && Number.isFinite(f.lat) && Number.isFinite(f.lon));
  } catch (e) {
    return [];
  }
}

// Extract route (origin/destination) from adsb.lol aircraft object — primary source when available; API/feeders may send from_icao/to_icao, from/to, route string, etc.
function routeFromAdsbLol(a) {
  const rawFrom = a.from_icao ?? a.from ?? a.departure_icao ?? a.dep ?? a.departure ?? a.origin_icao ?? a.origin ?? '';
  const rawTo = a.to_icao ?? a.to ?? a.arrival_icao ?? a.arr ?? a.arrival ?? a.destination_icao ?? a.destination ?? '';
  let fromIcao = String(rawFrom).toUpperCase().trim() || null;
  let toIcao = String(rawTo).toUpperCase().trim() || null;
  if (!fromIcao && !toIcao && a.route) {
    const routeStr = String(a.route).trim();
    const match = routeStr.match(/^([A-Z0-9]{3,4})[\s\-–—\/]+([A-Z0-9]{3,4})$/i);
    if (match) {
      fromIcao = match[1].toUpperCase();
      toIcao = match[2].toUpperCase();
    }
  }
  if (!fromIcao && !toIcao) return null;
  const origin = fromIcao ? resolveAirportByIcao(fromIcao) : null;
  const dest = toIcao ? resolveAirportByIcao(toIcao) : null;
  return {
    routeOrigin: fromIcao ?? null,
    routeDestination: toIcao ?? null,
    from: origin?.name ?? fromIcao,
    fromIata: origin?.iata ?? fromIcao,
    to: dest?.name ?? toIcao,
    toIata: dest?.iata ?? toIcao,
    originName: origin?.name ?? null,
    originIata: origin?.iata ?? null,
    destName: dest?.name ?? null,
    destIata: dest?.iata ?? null,
  };
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
    const ac = data.ac || data.aircraft || data.planes || [];
    if (ac.length === 0) return [];

    return ac.map(a => {
      const callsign = (a.flight || a.callsign || '').trim();
      const lat = Number(a.lat ?? a.latitude);
      const lon = Number(a.lon ?? a.lng ?? a.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const altitude = a.alt_baro === 'ground' ? 0 : (a.alt_baro || 0);
      const onGround = a.alt_baro === 'ground';
      const baroRate = a.baro_rate || 0; // ft/min
      const heading = a.track ?? a.true_heading ?? a.heading ?? 0;
      const velocity = a.gs || 0; // ground speed in knots

      // Distance from airport (rough nm: 1 deg lat ≈ 60nm)
      const distNm = Math.hypot((lat - airport.lat) * 60, (lon - airport.lon) * 60 * Math.cos(airport.lat * Math.PI / 180));
      const { direction, status } = classifyLiveFlight({ onGround, altFt: altitude, baroRateFpm: baroRate, distNm });

      const routeInfo = routeFromAdsbLol(a);
      return {
        id: (a.hex && String(a.hex).trim()) || (callsign && callsign.replace(/\s/g, '')) || 'unknown',
        callsign,
        flightNumber: callsign,
        status,
        type: direction,
        from: routeInfo?.from ?? '',
        fromIata: routeInfo?.fromIata ?? '',
        fromCountry: '',
        to: routeInfo?.to ?? '',
        toIata: routeInfo?.toIata ?? '',
        toCountry: '',
        airline: a.ownOp || resolveAirline(callsign),
        aircraft: a.t || '',
        aircraftReg: a.r || '',
        typecode: (a.t && String(a.t).trim()) || '',
        scheduledTime: '',
        lat,
        lon,
        altitude: onGround ? 0 : (altitude * 0.3048), // convert ft to meters
        velocity: velocity * 0.5144, // convert knots to m/s
        heading,
        nearestAirport: airport.iata,
        ...(routeInfo ? { routeOrigin: routeInfo.routeOrigin, routeDestination: routeInfo.routeDestination, originName: routeInfo.originName, destName: routeInfo.destName, originIata: routeInfo.originIata, destIata: routeInfo.destIata, routeSource: 'adsb.lol' } : {}),
        ...(direction === 'arrival' ? {
          destLat: airport.lat, destLon: airport.lon, destName: airport.name, destIata: airport.iata,
        } : direction === 'departure' ? {
          originLat: airport.lat, originLon: airport.lon, originName: airport.name, originIata: airport.iata,
        } : {}),
      };
    }).filter(f => f != null && Number.isFinite(f.lat) && Number.isFinite(f.lon));
  } catch (e) {
    return [];
  }
}

// --- adsb.lol Jamaica-wide (covers all of Jamaica + approaches) ---
const JAMAICA_CENTER = { lat: 18.0, lon: -77.5 };
const JAMAICA_WIDE_RADIUS_NM = 165; // nm from center — island + approaches + FIR; ensures ACL1166 and similar are included

function distNmFromJamaicaCenter(lat, lon) {
  if (lat == null || lon == null) return Infinity;
  return Math.hypot((lat - JAMAICA_CENTER.lat) * 60, (lon - JAMAICA_CENTER.lon) * 60 * Math.cos(JAMAICA_CENTER.lat * Math.PI / 180));
}

// Single source of truth for live flight direction and status from position/altitude/vertical rate.
// Ensures flight board and map status match. distNm = distance to assigned or nearest Jamaica airport.
function classifyLiveFlight({ onGround, altFt, verticalRateMps, baroRateFpm, distNm }) {
  const dist = distNm != null && Number.isFinite(distNm) ? distNm : 999;
  const alt = Number.isFinite(altFt) ? altFt : 0;
  const descending = (Number.isFinite(verticalRateMps) && verticalRateMps < -1) || (Number.isFinite(baroRateFpm) && baroRateFpm < -200);
  const climbing = (Number.isFinite(verticalRateMps) && verticalRateMps > 1) || (Number.isFinite(baroRateFpm) && baroRateFpm > 200);

  if (onGround) return { direction: 'arrival', status: 'On Ground' };
  if (descending && (alt <= 20000 || (alt > 20000 && dist <= 40))) return { direction: 'arrival', status: 'Approaching' };
  if (climbing && alt <= 15000) return { direction: 'departure', status: 'Departing' };
  if (alt <= 10000 && dist <= 15) return { direction: 'arrival', status: 'Approaching' };
  return { direction: 'flyover', status: 'Flyover' };
}

async function fetchAdsbLolJamaicaWide() {
  try {
    const url = `https://api.adsb.lol/v2/lat/${JAMAICA_CENTER.lat}/lon/${JAMAICA_CENTER.lon}/dist/${JAMAICA_WIDE_RADIUS_NM}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    const ac = data.ac || data.aircraft || data.planes || [];
    if (ac.length === 0) return [];

    return ac.map((a, idx) => {
      const callsign = (a.flight || a.callsign || '').trim();
      const altitude = a.alt_baro === 'ground' ? 0 : (a.alt_baro || 0);
      const onGround = a.alt_baro === 'ground';
      const baroRate = a.baro_rate || 0; // ft/min
      const lat = Number(a.lat ?? a.latitude);
      const lon = Number(a.lon ?? a.lng ?? a.longitude);
      const heading = a.track ?? a.true_heading ?? a.heading ?? 0;
      const velocity = a.gs || 0;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

      // Stable id: hex preferred, else callsign (no spaces so LAE2506 matches), else unique so we never collapse two aircraft
      const id = (a.hex && String(a.hex).trim()) || (callsign && callsign.replace(/\s/g, '')) || `wide-${lat.toFixed(4)}-${lon.toFixed(4)}-${idx}`;

      // Nearest Jamaica airport (for display, dest/origin, dedup)
      let nearest = JAMAICA_AIRPORTS[0];
      let minDist = Infinity;
      for (const ap of JAMAICA_AIRPORTS) {
        const d = Math.hypot((lat - ap.lat) * 60, (lon - ap.lon) * 60 * Math.cos(ap.lat * Math.PI / 180));
        if (d < minDist) { minDist = d; nearest = ap; }
      }

      const { direction, status } = classifyLiveFlight({ onGround, altFt: altitude, baroRateFpm: baroRate, distNm: minDist });

      const routeInfo = routeFromAdsbLol(a);
      return {
        id,
        callsign,
        flightNumber: callsign,
        status,
        type: direction,
        from: routeInfo?.from ?? '',
        fromIata: routeInfo?.fromIata ?? '',
        fromCountry: '',
        to: routeInfo?.to ?? '',
        toIata: routeInfo?.toIata ?? '',
        toCountry: '',
        airline: a.ownOp || resolveAirline(callsign),
        aircraft: a.t || '',
        aircraftReg: a.r || '',
        typecode: (a.t && String(a.t).trim()) || '',
        scheduledTime: '',
        lat,
        lon,
        altitude: onGround ? 0 : (altitude * 0.3048),
        velocity: velocity * 0.5144,
        heading,
        nearestAirport: nearest.iata,
        ...(routeInfo ? { routeOrigin: routeInfo.routeOrigin, routeDestination: routeInfo.routeDestination, originName: routeInfo.originName, destName: routeInfo.destName, originIata: routeInfo.originIata, destIata: routeInfo.destIata, routeSource: 'adsb.lol' } : {}),
        ...(direction === 'arrival' ? {
          destLat: nearest.lat, destLon: nearest.lon, destName: nearest.name, destIata: nearest.iata,
        } : direction === 'departure' ? {
          originLat: nearest.lat, originLon: nearest.lon, originName: nearest.name, originIata: nearest.iata,
        } : {}),
      };
    }).filter(f => f != null && Number.isFinite(f.lat) && Number.isFinite(f.lon));
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
// Per-airport cache: if MBJ (or KIN) returns 429, we keep showing last successful data for that airport.
const AERODATABOX_RETRY_DELAY_MS = 3500; // wait before retry after 429

async function fetchScheduledFlights() {
  let sources = [];

  if (RAPIDAPI_KEY) {
    try {
      for (const airport of AERODATABOX_AIRPORTS) {
        let result = await fetchAeroDataBox(airport);
        // Retry once on rate limit (429) so one burst doesn't empty an airport's board
        if (result.status === 429) {
          console.log(`[Flights] AeroDataBox ${airport.iata}: 429, retrying in ${AERODATABOX_RETRY_DELAY_MS / 1000}s`);
          await new Promise(r => setTimeout(r, AERODATABOX_RETRY_DELAY_MS));
          result = await fetchAeroDataBox(airport);
        }
        if (result.flights && result.flights.length > 0) {
          cachedScheduledByAirport[airport.iata] = result.flights;
          sources.push('aerodatabox');
        }
        // If result.flights is null (fetch failed), keep previous cachedScheduledByAirport[airport.iata] unchanged
        if (airport !== AERODATABOX_AIRPORTS[AERODATABOX_AIRPORTS.length - 1]) {
          await new Promise(r => setTimeout(r, 1100));
        }
      }
    } catch (e) {}
  }

  // Merge per-airport cache into one list
  let flights = [];
  for (const list of Object.values(cachedScheduledByAirport)) {
    if (Array.isArray(list)) flights.push(...list);
  }

  // Fallback: if no scheduled data at all, try OpenSky Jamaica-wide
  if (flights.length === 0) {
    const openSkyFlights = await fetchOpenSky();
    if (openSkyFlights.length > 0) {
      flights = openSkyFlights;
      sources.push('opensky');
    }
  }

  for (const f of flights) { f.dataSource = 'scheduled'; }
  cachedScheduledFlights = flights;
  cachedScheduledSources = sources.length ? [...new Set(sources)] : [];
  const byAirport = Object.entries(cachedScheduledByAirport).map(([iata, list]) => `${iata}:${(list || []).length}`).join(', ');
  console.log(`[Flights] Scheduled: ${flights.length} flights (${byAirport || 'none'}) from ${cachedScheduledSources.join(', ') || 'none'}`);
}

// --- Fetch live radar: adsb.lol (per-airport 25nm + Jamaica-wide) + OpenSky fallback; polled every LIVE_POLL_INTERVAL (30s) ---
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

  // Jamaica-wide adsb.lol: catch flyovers near the island but outside 25nm of any airport (e.g. AVA042)
  try {
    const wideFlights = await fetchAdsbLolJamaicaWide();
    liveFlights.push(...wideFlights);
  } catch (e) {}

  // OpenSky Jamaica-wide: full bounding box so we capture all overflights (e.g. UPS359) that adsb.lol public API may not return
  let openSkyWideCount = 0;
  try {
    const openSkyWide = await fetchOpenSkyJamaicaWide();
    openSkyWideCount = openSkyWide.length;
    liveFlights.push(...openSkyWide);
  } catch (e) {}

  // Deduplicate: same aircraft (by id) — keep one; use id so Jamaica-wide flights like LAE2506 are not dropped
  const byAircraft = new Map();
  const hasValidPos = (x) => x != null && Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lon));
  for (const f of liveFlights) {
    const key = f.id;
    const existing = byAircraft.get(key);
    if (!existing) {
      byAircraft.set(key, f);
    } else {
      // Prefer the flight that has valid position so map markers always render
      if (!hasValidPos(existing) && hasValidPos(f)) {
        byAircraft.set(key, f);
        continue;
      }
      if (hasValidPos(existing) && !hasValidPos(f)) continue; // keep existing
      // Prefer per-airport (has destLat/originLat) over Jamaica-wide flyover
      const hasAssignedAirport = (x) => (x.type === 'arrival' && x.destLat != null) || (x.type === 'departure' && x.originLat != null) || (x.type === 'flyover' && (x.destLat != null || x.originLat != null));
      if (hasAssignedAirport(f) && !hasAssignedAirport(existing)) {
        byAircraft.set(key, f);
      } else if (hasAssignedAirport(existing) && !hasAssignedAirport(f)) {
        // keep existing
      } else {
        // Both or neither: compare distance to assigned airport
        const apLat = f.type === 'arrival' ? f.destLat : f.originLat;
        const apLon = f.type === 'arrival' ? f.destLon : f.originLon;
        const existApLat = existing.type === 'arrival' ? existing.destLat : existing.originLat;
        const existApLon = existing.type === 'arrival' ? existing.destLon : existing.originLon;
        const dist = (apLat != null && apLon != null) ? Math.hypot(f.lat - apLat, f.lon - apLon) : Infinity;
        const existDist = (existApLat != null && existApLon != null) ? Math.hypot(existing.lat - existApLat, existing.lon - existApLon) : Infinity;
        if (dist < existDist) {
          byAircraft.set(key, f);
        }
      }
    }
  }
  liveFlights = Array.from(byAircraft.values());

  // Apply 150 nm and “landed” rules: arrivals stop when they land; departures and flyovers stop when past 150 nm
  liveFlights = liveFlights.filter(f => {
    const dist = distNmFromJamaicaCenter(f.lat, f.lon);
    if (f.type === 'arrival' || f.type === 'departure' || f.type === 'flyover') return dist <= JAMAICA_WIDE_RADIUS_NM;
    return true;
  });

  for (const f of liveFlights) { f.dataSource = 'live'; }

  // Enrich with route data (OpenSky routes + AeroDataBox schedule cross-reference)
  await enrichFlightsWithRoutes(liveFlights);

  // Merge scheduled and live flights into cache
  const allFlights = [...cachedScheduledFlights, ...liveFlights];
  const sources = [...cachedScheduledSources];
  if (liveFlights.length > 0 && !sources.includes('adsb.lol')) sources.push('adsb.lol');
  if (openSkyWideCount > 0 && !sources.includes('opensky')) sources.push('opensky');

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
      livePollIntervalSeconds: LIVE_POLL_INTERVAL / 1000,
      liveRadiusNm: JAMAICA_WIDE_RADIUS_NM,
    },
    timestamp: now,
  };

  const laeCount = liveFlights.filter(f => (f.callsign || '').replace(/\s/g, '').toUpperCase().includes('LAE')).length;
  console.log(`[Flights] Live radar: ${liveFlights.length} aircraft — total ${allFlights.length} flights (source: ${source})${laeCount ? ` — LAE in list: ${laeCount}` : ''}`);
}

// When we first mark a flight Landed/Departed/On Ground, store that time so client can hide it after 45 min
const completedAtByCallsign = new Map();

// Remove landed arrivals and departed departures from cache after this long (keeps flight board from growing indefinitely)
const COMPLETED_FLIGHT_HIDE_AFTER_MS = 45 * 60 * 1000; // 45 min
const COMPLETED_FLIGHT_CLEANUP_INTERVAL_MS = 2 * 60 * 1000; // run cleanup every 2 min

// Start background polling on server boot
(async () => {
  await fetchScheduledFlights();  // Get scheduled flights first
  await fetchLiveRadar();         // Then live radar
})();
setInterval(fetchScheduledFlights, SCHEDULED_POLL_INTERVAL);  // Every 15 min
setInterval(fetchLiveRadar, LIVE_POLL_INTERVAL);               // Every 30 sec
setInterval(removeCompletedFlightsFromCache, COMPLETED_FLIGHT_CLEANUP_INTERVAL_MS); // Remove Landed/Departed after 45 min

// True if status from schedule or live indicates the flight is not yet completed (impending)
function isImpendingStatus(status) {
  const s = (status || '').toLowerCase();
  const completed = ['landed', 'departed', 'on ground', 'cancelled', 'diverted'];
  return !completed.includes(s);
}

// Cross-reference scheduled flights with live radar to confirm arrival/departure statuses
function confirmFlightStatuses(flights) {
  const now = Date.now();
  const liveByCallsign = new Map();
  for (const f of flights) {
    if (f.dataSource === 'live') {
      const cs = (f.callsign || '').replace(/\s/g, '');
      if (cs) {
        for (const key of getCallsignMatchKeys(cs)) liveByCallsign.set(key, f);
      }
    }
  }

  return flights.map(f => {
    const cs = (f.callsign || f.flightNumber || '').replace(/\s/g, '');
    const matchKeys = getCallsignMatchKeys(cs);

    // Live flights: add completedAt when On Ground / Landed; persist under all key variants so scheduled (e.g. DL1997) sees it after aircraft drops off
    if (f.dataSource === 'live') {
      const status = (f.status || '').toLowerCase();
      const isImpending = f.status === 'Approaching' || f.status === 'Departing';
      if (status === 'on ground' || status === 'landed') {
        const completed = completedAtByCallsign.get(cs) || now;
        for (const key of matchKeys) completedAtByCallsign.set(key, completed);
        return { ...f, completedAt: completed, isImpending: false };
      }
      return { ...f, isImpending };
    }

    if (f.dataSource !== 'scheduled') return { ...f, isImpending: isImpendingStatus(f.status) };

    const liveFlight = matchKeys.map(k => liveByCallsign.get(k)).find(Boolean);

    // Parse scheduled time
    let scheduledMs = 0;
    if (f.scheduledTime) {
      try { scheduledMs = new Date(f.scheduledTime.replace(' ', 'T')).getTime(); } catch (e) {}
    }
    const minutesPast = scheduledMs ? (now - scheduledMs) / 60000 : 0;
    const scheduledInFuture = scheduledMs && minutesPast <= 0;

    // Signal 1: Live radar confirms aircraft on ground at airport
    if (liveFlight && liveFlight.status === 'On Ground') {
      const completed = completedAtByCallsign.get(cs) || now;
      for (const key of matchKeys) completedAtByCallsign.set(key, completed);
      return { ...f, status: f.type === 'arrival' ? 'Landed' : 'Departed', confirmedBy: 'radar', completedAt: completed, isImpending: false };
    }

    // Signal 1b: No current live contact but we previously saw this flight On Ground (aircraft dropped off list after landing)
    const seenCompletedAt = matchKeys.map(k => completedAtByCallsign.get(k)).find(t => t != null);
    if (seenCompletedAt != null) {
      return { ...f, status: f.type === 'arrival' ? 'Landed' : 'Departed', confirmedBy: 'radar', completedAt: seenCompletedAt, isImpending: false };
    }

    // Signal 2: Live radar shows aircraft in flight (approaching/departing) → impending
    if (liveFlight && (liveFlight.status === 'Approaching' || liveFlight.status === 'Departing')) {
      return { ...f, status: f.type === 'arrival' ? 'EnRoute' : 'Departing', confirmedBy: 'radar', isImpending: true };
    }

    // Signal 3: Past scheduled time with no radar contact → assume completed (15 min so board updates from "Expected" to "Landed" sooner)
    const PAST_SCHEDULED_MIN = 15;
    if (scheduledMs && minutesPast > PAST_SCHEDULED_MIN) {
      const completed = completedAtByCallsign.get(cs) || scheduledMs;
      for (const key of matchKeys) completedAtByCallsign.set(key, completed);
      return { ...f, status: f.type === 'arrival' ? 'Landed' : 'Departed', confirmedBy: 'time', completedAt: completed, isImpending: false };
    }

    // Still scheduled / expected: impending if scheduled time in future or status says not completed
    const isImpending = scheduledInFuture || isImpendingStatus(f.status);
    return { ...f, isImpending };
  });
}

// Scheduled cleanup: remove only LIVE landed/departed flights after 45 min. Never remove scheduled (AeroDataBox)
// flights — they often have past scheduled times and would otherwise be wiped, leaving no data on the board.
function removeCompletedFlightsFromCache() {
  if (!flightsCache.data || !Array.isArray(flightsCache.data.flights)) return;
  const raw = flightsCache.data.flights;
  const confirmed = confirmFlightStatuses(raw);
  const now = Date.now();
  const keepIndex = new Set();
  for (let i = 0; i < confirmed.length; i++) {
    const f = confirmed[i];
    // Only consider removing live flights; scheduled stay in cache (client hides them after 45 min)
    if (f.dataSource !== 'live') {
      keepIndex.add(i);
      continue;
    }
    const status = (f.status || '').toLowerCase();
    const completed = (f.type === 'arrival' && (status === 'landed' || status === 'on ground')) ||
      (f.type === 'departure' && status === 'departed');
    if (!completed) {
      keepIndex.add(i);
      continue;
    }
    const completedAt = f.completedAt != null
      ? (typeof f.completedAt === 'number' ? f.completedAt : new Date(f.completedAt).getTime())
      : 0;
    if (!completedAt || (now - completedAt) < COMPLETED_FLIGHT_HIDE_AFTER_MS) keepIndex.add(i);
  }
  const kept = raw.filter((_, i) => keepIndex.has(i));
  if (kept.length === raw.length) return;
  flightsCache = {
    data: { ...flightsCache.data, flights: kept },
    timestamp: now,
  };
  console.log(`[Flights] Cleanup: removed ${raw.length - kept.length} completed live flight(s), ${kept.length} remaining`);
}

// GET /api/flights — returns cached data with live status confirmation
router.get('/', (req, res) => {
  if (flightsCache.data) {
    const flights = flightsCache.data.flights.map(f => {
      if (f.dataSource === 'live' && (f.type === 'flyover' || f.type === 'arrival' || f.type === 'departure')) {
        const lat = Number(f.lat);
        const lon = Number(f.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) return { ...f, lat, lon };
      }
      return f;
    });
    const confirmed = confirmFlightStatuses(flights);
    return res.json({ ...flightsCache.data, flights: confirmed });
  }
  // First fetch hasn't completed yet
  res.json({
    flights: [],
    source: 'loading',
    time: Math.floor(Date.now() / 1000),
    airports: JAMAICA_AIRPORTS.map(a => ({ icao: a.icao, iata: a.iata, name: a.name, lat: a.lat, lon: a.lon })),
    livePollIntervalSeconds: LIVE_POLL_INTERVAL / 1000,
    liveRadiusNm: JAMAICA_WIDE_RADIUS_NM,
  });
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
