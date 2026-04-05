const { query } = require('./pg-query');
const { applySchema, seedParishes } = require('./init');
const { ensurePlacesTable, ingestPlacesFromOsm, queries } = require('./places-from-osm');
const { seedAirportsStatic } = require('./seed-airports');

const state = {
  inProgress: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: null,
  lastSummary: null,
  phase: 'idle',
  progressPercent: 0,
  currentStepLabel: null,
  sections: null,
  includeAirportsPlanned: false,
};

function initSectionRows() {
  const total = queries.length;
  return queries.map((q, i) => ({
    index: i + 1,
    total,
    category: q.category,
    status: 'pending',
    httpStatus: null,
    found: null,
    insertedAttempted: null,
    message: null,
  }));
}

function osmPercent(completedCount, total, includeAirports) {
  const wPrep = 6;
  const wAir = includeAirports ? 4 : 0;
  const wOsm = 100 - wPrep - wAir;
  const frac = total > 0 ? Math.min(1, completedCount / total) : 1;
  const cap = includeAirports ? 95 : 99;
  return Math.min(cap, Math.round(wPrep + frac * wOsm));
}

function makeOsmProgressHandler(includeAirports) {
  return (ev) => {
    if (!state.sections || ev.index < 0 || ev.index >= state.sections.length) return;
    if (ev.type === 'osm_start') {
      state.phase = 'osm';
      state.sections[ev.index].status = 'running';
      state.sections[ev.index].message = null;
      if (ev.retryRound && ev.retryIndex && ev.retryTotal) {
        state.currentStepLabel = `Retry ${ev.retryIndex}/${ev.retryTotal}: [${ev.index + 1}/${ev.total}] ${ev.category}`;
        state.progressPercent = Math.max(state.progressPercent, 95);
      } else {
        state.currentStepLabel = `[${ev.index + 1}/${ev.total}] ${ev.category}`;
        state.progressPercent = osmPercent(ev.index, ev.total, includeAirports);
      }
    } else if (ev.type === 'osm_end') {
      const row = state.sections[ev.index];
      row.status = ev.fetchOk ? 'ok' : 'error';
      row.httpStatus = ev.httpStatus ?? null;
      row.found = ev.found;
      row.insertedAttempted = ev.insertedAttempted;
      row.message = ev.fetchOk
        ? null
        : (ev.error || (ev.httpStatus ? `HTTP ${ev.httpStatus}` : 'Request failed'));
      if (ev.retryRound && ev.retryIndex && ev.retryTotal) {
        state.currentStepLabel = `Retry ${ev.retryIndex}/${ev.retryTotal}: [${ev.index + 1}/${ev.total}] ${ev.category}`;
        const t = Math.max(1, ev.retryTotal);
        state.progressPercent = Math.max(
          state.progressPercent,
          Math.min(99, 94 + Math.round((5 * ev.retryIndex) / t))
        );
      } else {
        state.currentStepLabel = `[${ev.index + 1}/${ev.total}] ${ev.category}`;
        state.progressPercent = osmPercent(ev.index + 1, ev.total, includeAirports);
      }
    }
  };
}

/**
 * Full rebuild: schema, parishes, clear places, OSM ingest, optional static airports.
 */
async function rebuildInventory(options = {}) {
  const onLog = options.onLog || ((m) => console.log(`[rebuild-inventory] ${m}`));
  const includeAirports = Boolean(options.includeAirports);
  state.sections = initSectionRows();
  state.includeAirportsPlanned = includeAirports;
  const onOsmProgress = makeOsmProgressHandler(includeAirports);

  state.phase = 'schema';
  state.progressPercent = 2;
  state.currentStepLabel = 'Applying schema';
  onLog('Applying SQL schema…');
  await applySchema();

  state.phase = 'parishes';
  state.progressPercent = 4;
  state.currentStepLabel = 'Seeding parishes';
  onLog('Ensuring parish seed data…');
  await seedParishes();
  await ensurePlacesTable();

  if (options.clearPlaces !== false) {
    state.phase = 'clear';
    state.progressPercent = 5;
    state.currentStepLabel = 'Clearing places';
    await query('DELETE FROM places');
    onLog('Cleared places table.');
  }

  state.phase = 'osm';
  state.progressPercent = osmPercent(0, queries.length, includeAirports);
  state.currentStepLabel = 'OpenStreetMap ingest';
  onLog('Ingesting places from OpenStreetMap (this takes several minutes)…');
  const osm = await ingestPlacesFromOsm({
    onLog,
    onProgress: onOsmProgress,
    ...(options.delayBetweenCategoriesMs != null
      ? { delayBetweenCategoriesMs: options.delayBetweenCategoriesMs }
      : {}),
  });

  let airportCount = null;
  if (includeAirports) {
    state.phase = 'airports';
    state.progressPercent = 97;
    state.currentStepLabel = 'Seeding airports (static)';
    onLog('Seeding airports (metadata only, no image crawl)…');
    await seedAirportsStatic();
    const ac = await query('SELECT COUNT(*)::bigint AS c FROM airports');
    airportCount = Number(ac.rows[0].c);
  }

  state.phase = 'done';
  state.progressPercent = 100;
  state.currentStepLabel = 'Complete';

  return {
    totalPlaces: osm.totalPlaces,
    totalInsertedAttempt: osm.totalInserted,
    categoriesFetched: osm.categories,
    airports: airportCount,
    osmFailedAfterMainPass: osm.failedRetriableAfterMainPass,
    osmStillFailedAfterRetries: osm.stillFailedAfterRetries,
  };
}

/**
 * Fire-and-forget background job (HTTP should respond immediately).
 * @param {object} [legacyDb] Ignored (PostgreSQL uses pool).
 * @param {object} options
 * @param {function} callback
 */
function startRebuildInventory(legacyDb, options, callback) {
  const opts = options && typeof options === 'object' ? options : {};
  const cb =
    typeof callback === 'function'
      ? callback
      : typeof options === 'function'
        ? options
        : () => {};

  if (state.inProgress) {
    if (typeof cb === 'function') cb(new Error('A rebuild is already in progress'));
    return false;
  }

  state.inProgress = true;
  state.lastError = null;
  state.lastSummary = null;
  state.lastStartedAt = new Date().toISOString();
  state.lastFinishedAt = null;
  state.phase = 'schema';
  state.progressPercent = 1;
  state.currentStepLabel = 'Starting…';

  rebuildInventory(opts)
    .then((summary) => {
      state.lastSummary = summary;
      state.lastError = null;
      state.lastFinishedAt = new Date().toISOString();
      cb(null, summary);
    })
    .catch((err) => {
      state.lastError = err && err.message ? err.message : String(err);
      state.lastSummary = null;
      state.lastFinishedAt = new Date().toISOString();
      state.phase = 'error';
      cb(err, null);
    })
    .finally(() => {
      state.inProgress = false;
    });
  return true;
}

function getRebuildInventoryState() {
  return {
    inProgress: state.inProgress,
    lastStartedAt: state.lastStartedAt,
    lastFinishedAt: state.lastFinishedAt,
    lastError: state.lastError,
    lastSummary: state.lastSummary,
    phase: state.phase,
    progressPercent: state.progressPercent,
    currentStepLabel: state.currentStepLabel,
    sections: state.sections,
    includeAirportsPlanned: state.includeAirportsPlanned,
  };
}

module.exports = {
  rebuildInventory,
  startRebuildInventory,
  getRebuildInventoryState,
};
