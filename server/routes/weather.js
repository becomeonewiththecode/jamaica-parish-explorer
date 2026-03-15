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

const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';
const CACHE_MS = 10 * 60 * 1000; // 10 minutes
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
  const slug = (req.params.slug || '').toLowerCase().trim();
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

// GET /api/weather/island — weather for all parishes (for map layer at zoom 9–12)
router.get('/island', async (req, res) => {
  if (islandCache.data && Date.now() - islandCache.ts < CACHE_MS) {
    return res.json(islandCache.data);
  }
  const entries = Object.entries(PARISH_COORDINATES);
  const results = await Promise.all(
    entries.map(async ([slug, [lat, lon]]) => {
      const raw = await fetchOpenMeteo(lat, lon);
      const out = normalizeResponse(raw);
      return out ? { slug, lat, lon, ...out } : { slug, lat, lon, error: true };
    })
  );
  const list = results.filter(r => !r.error);
  islandCache = { ts: Date.now(), data: list };
  res.json(list);
});

module.exports = router;
