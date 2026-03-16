const express = require('express');
const router = express.Router();

// Approximate parish/capital coordinates for Jamaica (for weather by parish)
const PARISH_COORDINATES = {
  'hanover': [18.45, -78.17],       // Lucea
  'westmoreland': [18.22, -78.13],  // Savanna-la-Mar
  'st-james': [18.47, -77.92],      // Montego Bay
  'trelawny': [18.49, -77.65],      // Falmouth
  'st-ann': [18.41, -77.10],        // St. Ann's Bay / Ocho Rios
  'st-elizabeth': [18.03, -77.85],  // Black River
  'manchester': [18.04, -77.50],    // Mandeville
  'clarendon': [17.97, -77.25],     // May Pen
  'st-mary': [18.37, -76.89],       // Port Maria
  'st-catherine': [17.99, -76.96], // Spanish Town
  'st-andrew': [18.01, -76.79],    // Half Way Tree
  'kingston': [17.997, -76.793],    // Kingston
  'st-thomas': [17.88, -76.41],    // Morant Bay
  'portland': [18.18, -76.45],      // Port Antonio
};

// Alternate spellings → canonical slug (for parish route only; island uses PARISH_COORDINATES keys)
const PARISH_SLUG_ALIASES = { 'trelawney': 'trelawny' };

const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';
const CACHE_MS = 10 * 60 * 1000; // 10 minutes (single-request cache)
const ISLAND_CACHE_MS = 20 * 60 * 1000; // 20 minutes — island data refreshed every 20 min
let cache = { key: null, data: null, ts: 0 };
let islandCache = { ts: 0, data: null };

async function fetchOpenMeteo(lat, lon) {
  const url = new URL(OPEN_METEO_BASE);
  url.searchParams.set('latitude', lat);
  url.searchParams.set('longitude', lon);
  url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,cloud_cover');
  url.searchParams.set('timezone', 'America/Jamaica');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    clearTimeout(timeout);
    console.error('Weather fetch error:', err.message);
    return null;
  }
}

function mapWeatherCode(code) {
  const map = {
    0: 'Clear',
    1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Foggy', 48: 'Depositing rime fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle',
    61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
    66: 'Light freezing rain', 67: 'Heavy freezing rain',
    71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
    77: 'Snow grains', 80: 'Slight showers', 81: 'Showers', 82: 'Heavy showers',
    85: 'Slight snow showers', 86: 'Heavy snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail',
  };
  return map[code] || 'Unknown';
}

function normalizeResponse(data) {
  if (!data?.current) return null;
  const c = data.current;
  return {
    temperature: c.temperature_2m,
    humidity: c.relative_humidity_2m,
    weatherCode: c.weather_code,
    description: mapWeatherCode(c.weather_code),
    windSpeed: c.wind_speed_10m,
    windDirection: c.wind_direction_10m,
    cloudCover: c.cloud_cover,
  };
}

// GET /api/weather?lat=18&lon=-77
router.get('/', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return res.status(400).json({ error: 'Missing or invalid lat/lon' });
  }
  const key = `ll:${lat}:${lon}`;
  if (cache.key === key && Date.now() - cache.ts < CACHE_MS) {
    return res.json(cache.data);
  }
  const raw = await fetchOpenMeteo(lat, lon);
  const out = normalizeResponse(raw);
  if (!out) {
    return res.status(502).json({ error: 'Weather service unavailable' });
  }
  cache = { key, data: out, ts: Date.now() };
  res.json(out);
});

// GET /api/weather/parish/:slug
router.get('/parish/:slug', async (req, res) => {
  let slug = (req.params.slug || '').toLowerCase().trim();
  slug = PARISH_SLUG_ALIASES[slug] || slug;
  const coords = PARISH_COORDINATES[slug];
  if (!coords) {
    return res.status(404).json({ error: 'Unknown parish' });
  }
  const [lat, lon] = coords;
  const key = `parish:${slug}`;
  if (cache.key === key && Date.now() - cache.ts < CACHE_MS) {
    return res.json(cache.data);
  }
  const raw = await fetchOpenMeteo(lat, lon);
  const out = normalizeResponse(raw);
  if (!out) {
    return res.status(502).json({ error: 'Weather service unavailable' });
  }
  cache = { key, data: out, ts: Date.now() };
  res.json(out);
});

// Fetch island weather for all parishes; returns full list (failed parishes have error: true so every parish has a marker)
async function fetchIslandWeather() {
  const entries = Object.entries(PARISH_COORDINATES);
  const results = await Promise.all(
    entries.map(async ([slug, [lat, lon]]) => {
      let raw = await fetchOpenMeteo(lat, lon);
      let out = raw ? normalizeResponse(raw) : null;
      if (!out) {
        raw = await fetchOpenMeteo(lat, lon);
        out = raw ? normalizeResponse(raw) : null;
      }
      return out
        ? { slug, lat, lon, ...out }
        : { slug, lat, lon, error: true, description: 'Unavailable' };
    })
  );
  return results; // include all parishes so client can show every parish (rain/sun/wind or unavailable)
}

// GET /api/weather/island — weather for all parishes (for map layer at zoom 9–12)
router.get('/island', async (req, res) => {
  if (islandCache.data && Date.now() - islandCache.ts < ISLAND_CACHE_MS) {
    return res.json(islandCache.data);
  }
  const list = await fetchIslandWeather();
  islandCache = { ts: Date.now(), data: list };
  res.json(list);
});

// --- Wave / marine (Open-Meteo Marine API) ---
const MARINE_API = 'https://marine-api.open-meteo.com/v1/marine';
const WAVE_CACHE_MS = 30 * 60 * 1000; // 30 minutes
let waveCache = { ts: 0, data: null };

// Coastal points around Jamaica for wave data (name, lat, lon)
// Manchester has a short south-facing coastline; Alligator Pond represents its marine point.
const COASTAL_POINTS = [
  { id: 'lucea', name: 'Lucea (Hanover)', lat: 18.48, lon: -78.20 },
  { id: 'negril', name: 'Negril', lat: 18.28, lon: -78.35 },
  { id: 'montego-bay', name: 'Montego Bay', lat: 18.47, lon: -77.92 },
  { id: 'falmouth', name: 'Falmouth (Trelawny)', lat: 18.52, lon: -77.65 }, // offshore so icon is over water
  { id: 'ocho-rios', name: 'Ocho Rios', lat: 18.41, lon: -77.10 },
  { id: 'port-antonio', name: 'Port Antonio', lat: 18.18, lon: -76.45 },
  { id: 'port-maria', name: 'Port Maria', lat: 18.37, lon: -76.89 },
  { id: 'morant-bay', name: 'Morant Bay', lat: 17.88, lon: -76.41 },
  { id: 'kingston', name: 'Kingston Harbour', lat: 17.97, lon: -76.79 },
  { id: 'old-harbour', name: 'Old Harbour (St. Catherine)', lat: 17.94, lon: -77.11 },
  { id: 'rocky-point', name: 'Rocky Point (Clarendon)', lat: 17.77, lon: -77.27 },
  { id: 'alligator-pond-manchester', name: 'Alligator Pond (Manchester)', lat: 17.88, lon: -77.56 },
  { id: 'black-river', name: 'Black River (St. Elizabeth)', lat: 18.03, lon: -77.85 },
  { id: 'treasure-beach', name: 'Treasure Beach (St. Elizabeth)', lat: 17.89, lon: -77.76 },
  { id: 'savanna-la-mar', name: 'Savanna-la-Mar', lat: 18.22, lon: -78.13 },
];

async function fetchMarinePoint({ id, name, lat, lon }) {
  const url = new URL(MARINE_API);
  url.searchParams.set('latitude', lat);
  url.searchParams.set('longitude', lon);
  url.searchParams.set('current', 'wave_height,wave_direction,wave_period');
  url.searchParams.set('timezone', 'America/Jamaica');
  url.searchParams.set('cell_selection', 'sea');

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(url.toString(), { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const data = await res.json();
      const c = data.current;
      if (c == null) continue;
      return {
        id,
        name,
        lat: data.latitude ?? lat,
        lon: data.longitude ?? lon,
        waveHeight: c.wave_height,
        waveDirection: c.wave_direction,
        wavePeriod: c.wave_period,
      };
    } catch (err) {
      clearTimeout(timeout);
      if (attempt === 1) console.error('Marine fetch error:', err.message);
    }
  }
  return { id, name, lat, lon, error: true };
}

// GET /api/weather/waves — wave conditions at coastal points (for map layer)
async function fetchWavesData() {
  const results = await Promise.all(COASTAL_POINTS.map(fetchMarinePoint));
  return results.filter(r => !r.error);
}

router.get('/waves', async (req, res) => {
  if (waveCache.data && Date.now() - waveCache.ts < WAVE_CACHE_MS) {
    return res.json(waveCache.data);
  }
  const list = await fetchWavesData();
  waveCache = { ts: Date.now(), data: list };
  res.json(list);
});

// Refresh weather and wave caches every 20 minutes so every parish has up-to-date rain/sun/wind and wave data
const REFRESH_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes

async function refreshWeatherAndWaves() {
  try {
    const list = await fetchIslandWeather();
    islandCache = { ts: Date.now(), data: list };
    console.log('[Weather] Island weather refreshed:', list.filter(r => !r.error).length, 'parishes OK');
  } catch (e) {
    console.error('[Weather] Island refresh failed:', e.message);
  }
  try {
    const waves = await fetchWavesData();
    waveCache = { ts: Date.now(), data: waves };
    console.log('[Weather] Wave data refreshed:', waves.length, 'points');
  } catch (e) {
    console.error('[Weather] Wave refresh failed:', e.message);
  }
}

// Run on load and every hour
refreshWeatherAndWaves();
setInterval(refreshWeatherAndWaves, REFRESH_INTERVAL_MS);

module.exports = router;
