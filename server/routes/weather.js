const express = require('express');
const router = express.Router();
const db = require('../db/connection');

// --- Configuration for weather sources (Open-Meteo, WeatherAPI, OpenWeatherMap) ---
const WEATHER_SOURCE = (process.env.WEATHER_SOURCE || 'open-meteo').toLowerCase();

// WeatherAPI (https://www.weatherapi.com/) — free tier requires an API key
const WEATHERAPI_KEY = process.env.WEATHERAPI_KEY || process.env.WEATHER_API_KEY || '';
const WEATHERAPI_BASE_URL = process.env.WEATHERAPI_BASE_URL || 'https://api.weatherapi.com/v1';

// OpenWeatherMap (https://openweathermap.org/) — free tier requires an API key
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY || process.env.OPEN_WEATHER_API_KEY || '';
const OPENWEATHER_BASE_URL = process.env.OPENWEATHER_BASE_URL || 'https://api.openweathermap.org';
const OPENWEATHER_UNITS = process.env.OPENWEATHER_UNITS || 'metric'; // metric | imperial | standard
const OPENWEATHER_LANG = process.env.OPENWEATHER_LANG || 'en';

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

// --- Provider-specific fetch helpers ---

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

async function fetchWeatherApi(lat, lon) {
  if (!WEATHERAPI_KEY) return null;
  const url = new URL(`${WEATHERAPI_BASE_URL.replace(/\/+$/, '')}/current.json`);
  url.searchParams.set('key', WEATHERAPI_KEY);
  url.searchParams.set('q', `${lat},${lon}`);
  url.searchParams.set('aqi', 'no');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    clearTimeout(timeout);
    console.error('WeatherAPI fetch error:', err.message);
    return null;
  }
}

async function fetchOpenWeather(lat, lon) {
  if (!OPENWEATHER_API_KEY) return null;
  const url = new URL(`${OPENWEATHER_BASE_URL.replace(/\/+$/, '')}/data/2.5/weather`);
  url.searchParams.set('lat', lat);
  url.searchParams.set('lon', lon);
  url.searchParams.set('appid', OPENWEATHER_API_KEY);
  url.searchParams.set('units', OPENWEATHER_UNITS);
  url.searchParams.set('lang', OPENWEATHER_LANG);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    clearTimeout(timeout);
    console.error('OpenWeather fetch error:', err.message);
    return null;
  }
}

// Fetch current conditions from all three providers in parallel
async function fetchAllProvidersCurrent(lat, lon) {
  const [om, wa, ow] = await Promise.all([
    fetchOpenMeteo(lat, lon),
    fetchWeatherApi(lat, lon),
    fetchOpenWeather(lat, lon),
  ]);
  const out = [];
  if (om) out.push({ source: 'open-meteo', raw: om });
  if (wa) out.push({ source: 'weatherapi', raw: wa });
  if (ow) out.push({ source: 'openweather', raw: ow });
  return out;
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

function normalizeCurrent(raw, source) {
  if (!raw) return null;

  // Open-Meteo format
  if (source === 'open-meteo' && raw.current && typeof raw.current.temperature_2m === 'number') {
    const c = raw.current;
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

  // WeatherAPI format (https://www.weatherapi.com/docs/)
  if (source === 'weatherapi' && raw.current && typeof raw.current.temp_c === 'number') {
    const c = raw.current;
    return {
      temperature: c.temp_c,
      humidity: c.humidity,
      weatherCode: c.condition?.code ?? null,
      description: c.condition?.text ?? 'Unknown',
      windSpeed: c.wind_kph != null ? c.wind_kph / 3.6 : null, // convert kph → m/s approx
      windDirection: c.wind_degree,
      cloudCover: c.cloud,
    };
  }

  // OpenWeatherMap format (https://openweathermap.org/current)
  if (source === 'openweather' && raw.main && Array.isArray(raw.weather)) {
    const w = raw.weather[0] || {};
    return {
      temperature: raw.main.temp,
      humidity: raw.main.humidity,
      weatherCode: w.id ?? null,
      description: w.description || 'Unknown',
      windSpeed: raw.wind?.speed ?? null,
      windDirection: raw.wind?.deg ?? null,
      cloudCover: raw.clouds?.all ?? null,
    };
  }

  return null;
}

function aggregateCurrent(list) {
  const normals = list
    .map(entry => {
      const norm = normalizeCurrent(entry.raw, entry.source);
      return norm ? { source: entry.source, ...norm } : null;
    })
    .filter(Boolean);

  if (!normals.length) return null;

  const temps = normals
    .map(n => n.temperature)
    .filter(t => typeof t === 'number')
    .sort((a, b) => a - b);
  const medianTemp = temps.length
    ? temps[Math.floor(temps.length / 2)]
    : null;

  const humidities = normals
    .map(n => n.humidity)
    .filter(h => typeof h === 'number');
  const avgHumidity = humidities.length
    ? humidities.reduce((a, b) => a + b, 0) / humidities.length
    : null;

  const base = normals[0];

  return {
    temperature: medianTemp ?? base.temperature,
    humidity: avgHumidity ?? base.humidity,
    weatherCode: base.weatherCode,
    description: base.description,
    windSpeed: base.windSpeed,
    windDirection: base.windDirection,
    cloudCover: base.cloudCover,
    sources: normals,
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
  const all = await fetchAllProvidersCurrent(lat, lon);
  const out = aggregateCurrent(all);
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
  const all = await fetchAllProvidersCurrent(lat, lon);
  const out = aggregateCurrent(all);
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
      let all = await fetchAllProvidersCurrent(lat, lon);
      let out = aggregateCurrent(all);
      if (!out) {
        all = await fetchAllProvidersCurrent(lat, lon);
        out = aggregateCurrent(all);
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

// GET /api/weather/events — list active / upcoming bad-weather events
router.get('/events', (req, res) => {
  const { type, parish } = req.query;
  let where = '1=1';
  const params = {};
  if (type) {
    where += ' AND type = @type';
    params.type = String(type);
  }
  if (parish) {
    where += ' AND parish_slug = @parish';
    params.parish = String(parish).toLowerCase();
  }
  // Only return events that are ongoing or start in the future
  where += ' AND (ends_at IS NULL OR ends_at >= datetime(\'now\', \'-1 hour\'))';

  const rows = db.prepare(`
    SELECT id, type, source, event_id, severity, headline, description, parish_slug, area, starts_at, ends_at, fetched_at
    FROM weather_events
    WHERE ${where}
    ORDER BY starts_at ASC
  `).all(params);

  res.json({ events: rows });
});

// Simple event classification based on Open-Meteo weather codes and wind/precip values
function classifyBadWeatherFromCurrent(slug, current) {
  const events = [];
  const code = current.weatherCode;
  const desc = current.description || '';
  const nowIso = new Date().toISOString();
  const twoHoursIso = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

  // Thunderstorms (95,96,99)
  if (code === 95 || code === 96 || code === 99 || /thunder/i.test(desc)) {
    events.push({
      type: 'thunderstorm',
      source: 'open-meteo',
      severity: 'severe',
      headline: 'Thunderstorm in area',
      description: desc || 'Thunderstorm likely',
      parish_slug: slug,
      area: null,
      starts_at: nowIso,
      ends_at: twoHoursIso,
    });
  }

  // Heavy rain (65,82 or description)
  if (code === 65 || code === 82 || /heavy rain|torrential/i.test(desc)) {
    events.push({
      type: 'heavy-rain',
      source: 'open-meteo',
      severity: 'moderate',
      headline: 'Heavy rain',
      description: desc || 'Heavy rain likely',
      parish_slug: slug,
      area: null,
      starts_at: nowIso,
      ends_at: twoHoursIso,
    });
  }

  // High wind (approx: > 12 m/s ≈ 43 km/h)
  if (typeof current.windSpeed === 'number' && current.windSpeed > 12) {
    events.push({
      type: 'high-wind',
      source: 'open-meteo',
      severity: 'moderate',
      headline: 'High winds',
      description: `Wind ${Math.round(current.windSpeed * 3.6)} km/h`,
      parish_slug: slug,
      area: null,
      starts_at: nowIso,
      ends_at: twoHoursIso,
    });
  }

  return events;
}

function classifyAnomalyFromSources(slug, aggregate) {
  if (!aggregate?.sources || aggregate.sources.length < 2) return null;
  const temps = aggregate.sources
    .map(s => s.temperature)
    .filter(t => typeof t === 'number')
    .sort((a, b) => a - b);
  if (temps.length < 2) return null;
  const spread = temps[temps.length - 1] - temps[0];
  if (spread < 5) return null; // less than 5°C difference → not anomalous enough

  const nowIso = new Date().toISOString();
  const twoHoursIso = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const descParts = aggregate.sources.map(s => `${s.source}: ${Math.round(s.temperature)}°C`);

  return {
    type: 'anomaly',
    source: 'aggregate',
    severity: 'minor',
    headline: 'Conflicting temperature readings',
    description: descParts.join(', '),
    parish_slug: slug,
    area: null,
    starts_at: nowIso,
    ends_at: twoHoursIso,
  };
}

function upsertWeatherEvents(events) {
  if (!events.length) return;
  const stmt = db.prepare(`
    INSERT INTO weather_events (type, source, event_id, severity, headline, description, parish_slug, area, starts_at, ends_at)
    VALUES (@type, @source, @event_id, @severity, @headline, @description, @parish_slug, @area, @starts_at, @ends_at)
  `);
  const tx = db.transaction((rows) => {
    for (const ev of rows) {
      stmt.run({
        type: ev.type,
        source: ev.source,
        event_id: ev.event_id || null,
        severity: ev.severity || null,
        headline: ev.headline || null,
        description: ev.description || null,
        parish_slug: ev.parish_slug || null,
        area: ev.area || null,
        starts_at: ev.starts_at || null,
        ends_at: ev.ends_at || null,
      });
    }
  });
  tx(events);
}

function pruneOldWeatherEvents() {
  db.prepare(`
    DELETE FROM weather_events
    WHERE ends_at IS NOT NULL AND ends_at < datetime('now', '-1 day')
  `).run();
}

// Refresh weather and wave caches every 20 minutes so every parish has up-to-date rain/sun/wind and wave data
const REFRESH_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes

async function refreshWeatherAndWaves() {
  try {
    const list = await fetchIslandWeather();
    islandCache = { ts: Date.now(), data: list };
    console.log('[Weather] Island weather refreshed:', list.filter(r => !r.error).length, 'parishes OK');
    // Derive bad-weather and anomaly events from aggregate data
    const derivedEvents = [];
    for (const item of list) {
      if (item.error) continue;
      const slug = item.slug;
      const current = {
        temperature: item.temperature,
        humidity: item.humidity,
        weatherCode: item.weatherCode,
        description: item.description,
        windSpeed: item.windSpeed,
        windDirection: item.windDirection,
        cloudCover: item.cloudCover,
      };
      derivedEvents.push(...classifyBadWeatherFromCurrent(slug, current));
      const anomaly = classifyAnomalyFromSources(slug, item);
      if (anomaly) derivedEvents.push(anomaly);
    }
    pruneOldWeatherEvents();
    upsertWeatherEvents(derivedEvents);
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
