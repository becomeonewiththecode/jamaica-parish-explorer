const express = require('express');
const router = express.Router();

// Jamaica + surrounding airspace bounding box
const JAMAICA_BBOX = {
  lamin: 16.5,
  lamax: 20.0,
  lomin: -80.0,
  lomax: -74.5,
};

// Jamaica airport ICAO codes
const JAMAICA_AIRPORTS = ['MKJP', 'MKJS', 'MKBS', 'MKTP'];

// Cache to avoid hammering OpenSky (10-second resolution for anonymous)
let flightsCache = { data: null, timestamp: 0 };
const CACHE_TTL = 15000; // 15 seconds

// GET /api/flights — live aircraft over/near Jamaica
router.get('/', async (req, res) => {
  const now = Date.now();

  if (flightsCache.data && (now - flightsCache.timestamp) < CACHE_TTL) {
    return res.json(flightsCache.data);
  }

  try {
    const url = `https://opensky-network.org/api/states/all?lamin=${JAMAICA_BBOX.lamin}&lamax=${JAMAICA_BBOX.lamax}&lomin=${JAMAICA_BBOX.lomin}&lomax=${JAMAICA_BBOX.lomax}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'JamaicaParishExplorer/1.0' },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.json({ flights: [], time: Math.floor(now / 1000), error: 'OpenSky API unavailable' });
    }

    const data = await response.json();

    const flights = (data.states || []).map(s => ({
      icao24: s[0],
      callsign: (s[1] || '').trim(),
      origin_country: s[2],
      lat: s[6],
      lon: s[5],
      altitude: s[7],        // geometric altitude in meters
      velocity: s[9],         // m/s
      heading: s[10],         // degrees clockwise from north
      vertical_rate: s[11],   // m/s
      on_ground: s[8],
      squawk: s[14],
    })).filter(f => f.lat && f.lon);

    const result = {
      flights,
      time: data.time,
      airports: JAMAICA_AIRPORTS,
      bbox: JAMAICA_BBOX,
    };

    flightsCache = { data: result, timestamp: now };
    res.json(result);
  } catch (e) {
    res.json({ flights: [], time: Math.floor(now / 1000), error: e.message });
  }
});

module.exports = router;
