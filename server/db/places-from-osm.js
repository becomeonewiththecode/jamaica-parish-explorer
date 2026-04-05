const fs = require('fs');
const path = require('path');

const PLACES_DDL = `
CREATE TABLE IF NOT EXISTS places (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    parish_id   INTEGER NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
    osm_id      TEXT UNIQUE,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL,
    lat         REAL NOT NULL,
    lon         REAL NOT NULL,
    address     TEXT,
    phone       TEXT,
    website     TEXT,
    opening_hours TEXT,
    cuisine     TEXT,
    stars       INTEGER,
    description   TEXT,
    image_url     TEXT,
    menu_url      TEXT,
    tiktok_url    TEXT,
    instagram_url TEXT,
    booking_url   TEXT,
    tripadvisor_url TEXT,
    fetched_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_places_parish ON places(parish_id);
CREATE INDEX IF NOT EXISTS idx_places_category ON places(category);
CREATE INDEX IF NOT EXISTS idx_places_osm ON places(osm_id);
`;

function ensurePlacesTable(db) {
  db.exec(PLACES_DDL);
}

let _geojsonCache;
function loadGeojson() {
  if (_geojsonCache) return _geojsonCache;
  const geojsonPath = path.join(__dirname, '..', '..', 'client', 'public', 'jamaica-parishes.geojson');
  _geojsonCache = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
  return _geojsonCache;
}

const nameToSlug = {
  Hanover: 'hanover',
  Westmoreland: 'westmoreland',
  'Saint James': 'st-james',
  Trelawny: 'trelawny',
  'Saint Ann': 'st-ann',
  'Saint Elizabeth': 'st-elizabeth',
  Manchester: 'manchester',
  Clarendon: 'clarendon',
  'Saint Mary': 'st-mary',
  'Saint Catherine': 'st-catherine',
  'Saint Andrew': 'st-andrew',
  Kingston: 'kingston',
  'Saint Thomas': 'st-thomas',
  Portland: 'portland',
};

function pointInPolygon(lat, lon, polygon) {
  const ring = polygon[0];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (((yi > lat) !== (yj > lat)) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function findParishForPoint(lat, lon, geojson) {
  for (const feature of geojson.features) {
    const name = feature.properties.shapeName;
    const slug = nameToSlug[name];
    if (!slug) continue;
    const geom = feature.geometry;
    const polygons = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
    for (const poly of polygons) {
      if (pointInPolygon(lat, lon, poly)) return slug;
    }
  }
  return null;
}

const queries = [
  { category: 'tourist_attraction', query: '"tourism"~"attraction|museum|gallery|viewpoint|artwork"' },
  { category: 'landmark', query: '"historic"~"monument|memorial|castle|ruins|fort"' },
  { category: 'restaurant', query: '"amenity"="restaurant"' },
  { category: 'restaurant', query: '"amenity"="fast_food"' },
  { category: 'cafe', query: '"amenity"="cafe"' },
  { category: 'hotel', query: '"tourism"~"hotel|motel"' },
  { category: 'guest_house', query: '"tourism"~"guest_house|hostel"' },
  { category: 'hospital', query: '"amenity"~"hospital|clinic"' },
  { category: 'school', query: '"amenity"~"school|university|college"' },
  { category: 'beach', query: '"natural"="beach"' },
  { category: 'place_of_worship', query: '"amenity"="place_of_worship"' },
  { category: 'bank', query: '"amenity"="bank"' },
  { category: 'gas_station', query: '"amenity"="fuel"' },
  { category: 'park', query: '"leisure"="park"' },
  { category: 'stadium', query: '"leisure"="stadium"' },
  { category: 'stadium', query: '"leisure"="pitch"["name"]' },
  { category: 'nightlife', query: '"amenity"~"bar|pub|nightclub"' },
  { category: 'shopping', query: '"shop"~"supermarket|mall|department_store|convenience"' },
  { category: 'car_rental', query: '"amenity"="car_rental"' },
];

const BBOX = '17.7,-78.4,18.6,-76.1';

/** Public Overpass instances (rotate on rate limits). Override with OVERPASS_ENDPOINTS=comma-separated URLs. */
function getOverpassInterpreterUrls() {
  const raw = process.env.OVERPASS_ENDPOINTS;
  if (raw && String(raw).trim()) {
    return String(raw)
      .split(',')
      .map((s) => {
        let u = s.trim().replace(/\/$/, '');
        if (!u) return null;
        if (!u.includes('/api/interpreter')) u = `${u}/api/interpreter`;
        return u;
      })
      .filter(Boolean);
  }
  return [
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://z.overpass-api.kumi.systems/api/interpreter',
  ];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function overpassMaxAttempts() {
  const v = process.env.OVERPASS_MAX_ATTEMPTS;
  if (v === undefined || v === '') return 12;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(30, n) : 12;
}

function waitSecondsBeforeRetry(status, zeroBasedRetryIndex, res) {
  const ra = res.headers.get('retry-after');
  if (ra) {
    const sec = parseInt(ra, 10);
    if (Number.isFinite(sec) && sec > 0) return Math.min(300, sec);
  }
  const rateLimited = status === 429;
  const base = rateLimited ? 28 : 14;
  const mult = Math.pow(1.4, zeroBasedRetryIndex);
  return Math.min(180, Math.round(base * mult));
}

function waitSecondsAfterNetworkError(zeroBasedAttempt) {
  return Math.min(120, 12 + zeroBasedAttempt * 18);
}

function defaultCategoryDelayMs() {
  const v = process.env.OVERPASS_CATEGORY_DELAY_MS;
  if (v === undefined || v === '') return 12000;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 12000;
}

function failedRoundInitialDelayMs() {
  const v = process.env.OVERPASS_FAILED_ROUND_DELAY_MS;
  if (v === undefined || v === '') return 120000;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 120000;
}

function retryCategoryDelayMs() {
  const v = process.env.OVERPASS_RETRY_CATEGORY_DELAY_MS;
  if (v === undefined || v === '') return 35000;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 35000;
}

/** How many extra delayed rounds after the main pass (only retriable failures). 0 = off. */
function failedRetryRoundsMax() {
  const v = process.env.OVERPASS_FAILED_RETRY_ROUNDS;
  if (v === undefined || v === '') return 1;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(4, n) : 1;
}

function overpassRetryRoundMaxAttempts() {
  const v = process.env.OVERPASS_RETRY_ROUND_MAX_ATTEMPTS;
  if (v === undefined || v === '') return Math.max(overpassMaxAttempts(), 18);
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(40, n) : Math.max(overpassMaxAttempts(), 18);
}

function isRetriableOverpassFailure(fetchResult) {
  if (fetchResult.fetchOk) return false;
  const s = fetchResult.httpStatus;
  if (s === 400) return false;
  return s === 429 || s === 502 || s === 503 || s === 504 || s === 0;
}

async function fetchCategory(queryDef, onLog, fetchOpts = {}) {
  const overpassQuery = `
    [out:json][timeout:90];
    (
      node[${queryDef.query}](${BBOX});
      way[${queryDef.query}](${BBOX});
    );
    out center tags;
  `;

  const urls = getOverpassInterpreterUrls();
  const maxAttempts =
    fetchOpts.maxAttempts != null ? fetchOpts.maxAttempts : overpassMaxAttempts();
  const body = 'data=' + encodeURIComponent(overpassQuery);
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'JamaicaParishExplorer/1.0 (OSM places ingest; contact via repo maintainer)',
  };

  onLog(`  Fetching ${queryDef.category}...`);

  let lastStatus = 0;
  let lastError = 'Max retries exceeded';

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const url = urls[attempt % urls.length];
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers, body });
    } catch (e) {
      lastError = e && e.message ? e.message : String(e);
      if (attempt + 1 >= maxAttempts) {
        onLog(`  Network error (${lastError}); giving up.`);
        return { elements: [], httpStatus: 0, fetchOk: false, error: lastError };
      }
      const nw = waitSecondsAfterNetworkError(attempt);
      onLog(`  Network error (${lastError}); waiting ${nw}s, then retry (${attempt + 2}/${maxAttempts})…`);
      await sleep(nw * 1000);
      continue;
    }

    lastStatus = res.status;

    if (res.ok) {
      let data;
      try {
        data = await res.json();
      } catch (e) {
        const msg = e && e.message ? e.message : 'Invalid JSON';
        onLog(`  Failed: ${msg}`);
        return { elements: [], httpStatus: res.status, fetchOk: false, error: msg };
      }
      if (attempt > 0) onLog(`  OK from Overpass after ${attempt + 1} attempt(s).`);
      return { elements: data.elements || [], httpStatus: res.status, fetchOk: true, error: null };
    }

    lastError = `${res.status} ${res.statusText}`;

    if (res.status === 400) {
      onLog(`  Failed: ${lastError} (bad query)`);
      return { elements: [], httpStatus: res.status, fetchOk: false, error: lastError };
    }

    const retryable = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
    if (!retryable || attempt + 1 >= maxAttempts) {
      onLog(`  Failed: ${lastError}`);
      return { elements: [], httpStatus: res.status, fetchOk: false, error: lastError };
    }

    const waitSec = waitSecondsBeforeRetry(res.status, attempt, res);
    const host = (() => {
      try {
        return new URL(url).host;
      } catch {
        return 'overpass';
      }
    })();
    onLog(`  ${res.status} from ${host}; waiting ${waitSec}s, then retry (${attempt + 2}/${maxAttempts})…`);
    await sleep(waitSec * 1000);
  }

  return { elements: [], httpStatus: lastStatus, fetchOk: false, error: lastError };
}

function insertElementsIntoPlaces(elements, queryDef, geojson, insertPlace, getParishId) {
  let inserted = 0;
  for (const el of elements) {
    const lat = el.lat || (el.center && el.center.lat);
    const lon = el.lon || (el.center && el.center.lon);
    const tags = el.tags || {};
    const name = tags.name || tags['name:en'];

    if (!lat || !lon || !name) continue;

    const slug = findParishForPoint(lat, lon, geojson);
    if (!slug) continue;

    const parish = getParishId.get(slug);
    if (!parish) continue;

    const osmId = `${el.type}/${el.id}`;
    const address = [tags['addr:street'], tags['addr:city']].filter(Boolean).join(', ') || null;

    try {
      insertPlace.run(
        parish.id,
        osmId,
        name,
        queryDef.category,
        lat,
        lon,
        address,
        tags.phone || tags['contact:phone'] || null,
        tags.website || tags['contact:website'] || null,
        tags.opening_hours || null,
        tags.cuisine || null,
        tags.stars ? parseInt(tags.stars, 10) : null
      );
      inserted++;
    } catch {
      // duplicate osm_id
    }
  }
  return inserted;
}

async function runOneOsmCategory(i, queryDef, ctx) {
  const {
    total,
    onLog,
    onProgress,
    fetchOpts,
    retryRound,
    retryIndex,
    retryTotal,
    geojson,
    insertPlace,
    getParishId,
  } = ctx;

  const prefix = retryRound ? `  [retry ${retryIndex}/${retryTotal}] ` : '  ';
  onLog(`${prefix}[${i + 1}/${total}] ${queryDef.category}…`);
  onProgress?.({
    type: 'osm_start',
    index: i,
    total,
    category: queryDef.category,
    retryRound: Boolean(retryRound),
    retryIndex: retryIndex || null,
    retryTotal: retryTotal || null,
  });

  const fetchResult = await fetchCategory(queryDef, onLog, fetchOpts || {});
  const elements = fetchResult.elements || [];
  const inserted = insertElementsIntoPlaces(elements, queryDef, geojson, insertPlace, getParishId);

  onLog(`${prefix}${queryDef.category}: ${elements.length} found, ${inserted} new rows attempted`);

  onProgress?.({
    type: 'osm_end',
    index: i,
    total,
    category: queryDef.category,
    found: elements.length,
    insertedAttempted: inserted,
    httpStatus: fetchResult.httpStatus,
    fetchOk: fetchResult.fetchOk,
    error: fetchResult.error,
    retryRound: Boolean(retryRound),
    retryIndex: retryIndex || null,
    retryTotal: retryTotal || null,
  });

  return { inserted, fetchResult };
}

/** Insert OSM POIs into places (INSERT OR IGNORE per osm_id). */
async function ingestPlacesFromOsm(db, opts = {}) {
  const onLog = opts.onLog || ((s) => console.log(s));
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const delayMs = opts.delayBetweenCategoriesMs ?? defaultCategoryDelayMs();
  const retryRounds =
    opts.failedRetryRounds != null ? opts.failedRetryRounds : failedRetryRoundsMax();

  ensurePlacesTable(db);
  const geojson = loadGeojson();

  const insertPlace = db.prepare(`
  INSERT OR IGNORE INTO places (parish_id, osm_id, name, category, lat, lon, address, phone, website, opening_hours, cuisine, stars)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

  const getParishId = db.prepare('SELECT id FROM parishes WHERE slug = ?');

  const ctxBase = { geojson, insertPlace, getParishId };

  let totalInserted = 0;
  const total = queries.length;
  let failedIndices = [];

  for (let i = 0; i < queries.length; i++) {
    const queryDef = queries[i];
    const { inserted, fetchResult } = await runOneOsmCategory(i, queryDef, {
      ...ctxBase,
      total,
      onLog,
      onProgress,
      fetchOpts: {},
    });
    totalInserted += inserted;
    if (!fetchResult.fetchOk && isRetriableOverpassFailure(fetchResult)) {
      failedIndices.push(i);
    }
    if (i < queries.length - 1) {
      await sleep(delayMs);
    }
  }

  let stillFailedIndices = [...failedIndices];

  if (failedIndices.length > 0 && retryRounds > 0) {
    let roundDelay = failedRoundInitialDelayMs();
    const betweenRetry = retryCategoryDelayMs();
    const slowFetchOpts = { maxAttempts: overpassRetryRoundMaxAttempts() };
    let pending = [...failedIndices];

    for (let r = 0; r < retryRounds && pending.length > 0; r++) {
      onLog(
        `--- Overpass: waiting ${Math.round(roundDelay / 1000)}s, then retry round ${r + 1}/${retryRounds} for ${pending.length} failed step(s) (slower pacing: ${betweenRetry}ms between) ---`
      );
      await sleep(roundDelay);
      roundDelay = Math.min(360000, Math.round(roundDelay * 1.35));

      const stillFailed = [];
      for (let k = 0; k < pending.length; k++) {
        const i = pending[k];
        const queryDef = queries[i];
        const { inserted, fetchResult } = await runOneOsmCategory(i, queryDef, {
          ...ctxBase,
          total,
          onLog,
          onProgress,
          fetchOpts: slowFetchOpts,
          retryRound: true,
          retryIndex: k + 1,
          retryTotal: pending.length,
        });
        totalInserted += inserted;
        if (!fetchResult.fetchOk && isRetriableOverpassFailure(fetchResult)) {
          stillFailed.push(i);
        }
        if (k < pending.length - 1) {
          await sleep(betweenRetry);
        }
      }
      pending = stillFailed;
    }

    stillFailedIndices = pending;

    if (stillFailedIndices.length > 0) {
      onLog(
        `--- Overpass: ${stillFailedIndices.length} step(s) still failed after retry round(s): ${stillFailedIndices.map((i) => `${i + 1}:${queries[i].category}`).join(', ')} ---`
      );
    }
  } else if (failedIndices.length > 0 && retryRounds === 0) {
    onLog(
      `--- Overpass: ${failedIndices.length} step(s) failed (retries disabled via OVERPASS_FAILED_RETRY_ROUNDS=0) ---`
    );
  }

  const totalPlaces = db.prepare('SELECT COUNT(*) as c FROM places').get().c;
  onLog(`Done. Total rows in places: ${totalPlaces} (this run attempted ~${totalInserted} inserts).`);

  return {
    totalInserted,
    categories: queries.length,
    totalPlaces,
    failedRetriableAfterMainPass: failedIndices.length,
    stillFailedAfterRetries: stillFailedIndices.length,
  };
}

module.exports = { ensurePlacesTable, ingestPlacesFromOsm, queries };
