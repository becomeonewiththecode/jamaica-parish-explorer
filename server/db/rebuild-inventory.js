const { query } = require('./pg-query');
const {
  applySchema,
  seedParishes,
  upsertParishesFromSeed,
  resyncFeaturesFromSeed,
} = require('./init');
const { ensurePlacesTable, ingestPlacesFromOsm, queries } = require('./places-from-osm');
const { seedAirportsStatic } = require('./seed-airports');
const { seedDefaultCruisePorts } = require('./cruise-schedules');

const SELECTIVE_REFRESH_ORDER = [
  'parishes',
  'features',
  'places',
  'airports',
  'notes_clear',
  'flights',
  'cruise_ports',
  'cruise_calls',
];

const VALID_REFRESH_TARGETS = new Set(SELECTIVE_REFRESH_ORDER);

function lazyFlightsRouter() {
  return require('../routes/flights');
}

function lazyPortCruiseRouter() {
  return require('../routes/port-cruises');
}

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
 * Run only selected refresh steps (same global lock as full rebuild).
 * @param {Set<string>} targets
 */
async function selectiveDataRefresh(targets, options = {}) {
  const onLog = options.onLog || ((m) => console.log(`[data-refresh] ${m}`));
  const includeAirportsAfterOsm = Boolean(options.includeAirports);
  const clearPlaces = options.clearPlaces !== false;
  let lastOsmSummary = null;

  const needSchema = ['parishes', 'features', 'places', 'airports', 'notes_clear'].some((t) =>
    targets.has(t)
  );
  if (needSchema) {
    state.phase = 'schema';
    state.progressPercent = 5;
    state.currentStepLabel = 'Applying schema';
    state.sections = null;
    onLog('Applying schema…');
    await applySchema();
  }

  for (const step of SELECTIVE_REFRESH_ORDER) {
    if (!targets.has(step)) continue;

    if (step === 'parishes') {
      state.phase = 'parishes';
      state.progressPercent = 18;
      state.currentStepLabel = 'Upserting parishes from seed';
      onLog('Upserting parish metadata from seed…');
      await upsertParishesFromSeed();
    }

    if (step === 'features') {
      state.phase = 'features';
      state.progressPercent = 28;
      state.currentStepLabel = 'Resyncing parish features';
      onLog('Replacing parish feature lists from seed…');
      await resyncFeaturesFromSeed();
    }

    if (step === 'places') {
      state.phase = 'parishes';
      state.progressPercent = Math.max(state.progressPercent, 30);
      state.currentStepLabel = 'Seeding parishes (if needed)';
      onLog('Ensuring parish seed data before OSM ingest…');
      await seedParishes();
      await ensurePlacesTable();
      if (clearPlaces) {
        state.phase = 'clear';
        state.progressPercent = 32;
        state.currentStepLabel = 'Clearing places';
        onLog('Clearing places table…');
        await query('DELETE FROM places');
      }
      state.phase = 'osm';
      state.sections = initSectionRows();
      state.includeAirportsPlanned = includeAirportsAfterOsm;
      const onOsmProgress = makeOsmProgressHandler(includeAirportsAfterOsm);
      state.progressPercent = osmPercent(0, queries.length, includeAirportsAfterOsm);
      state.currentStepLabel = 'OpenStreetMap ingest';
      onLog('Ingesting places from OpenStreetMap…');
      const osm = await ingestPlacesFromOsm({
        onLog,
        onProgress: onOsmProgress,
        ...(options.delayBetweenCategoriesMs != null
          ? { delayBetweenCategoriesMs: options.delayBetweenCategoriesMs }
          : {}),
      });
      if (includeAirportsAfterOsm) {
        state.phase = 'airports';
        state.progressPercent = 97;
        state.currentStepLabel = 'Seeding airports (static)';
        onLog('Seeding airports after OSM ingest…');
        await seedAirportsStatic();
      }
      lastOsmSummary = osm;
      continue;
    }

    if (step === 'airports') {
      if (targets.has('places') && includeAirportsAfterOsm) {
        onLog('Skipping standalone airports step (already run after OSM).');
        continue;
      }
      state.phase = 'airports';
      state.progressPercent = Math.max(state.progressPercent, 60);
      state.currentStepLabel = 'Seeding airports (static)';
      onLog('Seeding airports (metadata only)…');
      await seedAirportsStatic();
      const ac = await query('SELECT COUNT(*)::bigint AS c FROM airports');
      onLog(`Airports row count: ${ac.rows[0].c}`);
    }

    if (step === 'notes_clear') {
      state.phase = 'notes_clear';
      state.progressPercent = Math.max(state.progressPercent, 50);
      state.currentStepLabel = 'Clearing user notes';
      onLog('Deleting all rows from notes…');
      await query('DELETE FROM notes');
    }

    if (step === 'flights') {
      state.phase = 'flights';
      state.progressPercent = Math.max(state.progressPercent, 70);
      state.currentStepLabel = 'Refreshing flight providers';
      onLog('Fetching scheduled + live flights from providers…');
      await lazyFlightsRouter().runManualProviderRefresh();
    }

    if (step === 'cruise_ports') {
      state.phase = 'cruise_ports';
      state.progressPercent = Math.max(state.progressPercent, 75);
      state.currentStepLabel = 'Upserting cruise ports';
      onLog('Upserting default Jamaica cruise ports…');
      await seedDefaultCruisePorts();
    }

    if (step === 'cruise_calls') {
      state.phase = 'cruise_calls';
      state.progressPercent = Math.max(state.progressPercent, 85);
      state.currentStepLabel = 'Re-scraping cruise schedules';
      onLog('Re-scraping cruise schedules (all ports)…');
      await lazyPortCruiseRouter().refreshAllCruiseSchedulesForce();
    }
  }

  state.phase = 'done';
  state.progressPercent = 100;
  state.currentStepLabel = 'Complete';
  return { selective: true, targets: [...targets], osm: lastOsmSummary };
}

function startSelectiveRefresh(targets, options, callback) {
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

  const set = targets instanceof Set ? targets : new Set(Array.isArray(targets) ? targets : []);
  if (set.size === 0) {
    if (typeof cb === 'function') cb(new Error('No refresh targets'));
    return false;
  }
  for (const t of set) {
    if (!VALID_REFRESH_TARGETS.has(t)) {
      if (typeof cb === 'function') cb(new Error(`Invalid refresh target: ${t}`));
      return false;
    }
  }

  state.inProgress = true;
  state.lastError = null;
  state.lastSummary = null;
  state.lastStartedAt = new Date().toISOString();
  state.lastFinishedAt = null;
  state.phase = 'schema';
  state.progressPercent = 1;
  state.currentStepLabel = 'Starting selective refresh…';
  state.sections = null;
  state.includeAirportsPlanned = false;

  selectiveDataRefresh(set, opts)
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

/**
 * Fire-and-forget full rebuild (HTTP should respond immediately).
 * @param {object} [legacyDb] Ignored (PostgreSQL uses pool).
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

/**
 * Live row counts for admin UI / wipe confirmation. Cheap COUNT(*) queries.
 * With Docker bind mounts, PostgreSQL data persists until removed or until rebuild deletes places.
 */
async function getRebuildInventoryDataSnapshot() {
  const snapshot = {
    placesCount: null,
    placesQueryable: false,
    placesCountError: null,
    airportsCount: null,
    notesCount: null,
    hasExistingPlacesData: null,
    wipeWarning: '',
  };

  try {
    const r = await query('SELECT COUNT(*)::bigint AS c FROM places');
    snapshot.placesCount = Number(r.rows[0].c);
    snapshot.placesQueryable = true;
    snapshot.hasExistingPlacesData = snapshot.placesCount > 0;
    snapshot.wipeWarning =
      snapshot.placesCount > 0
        ? `Rebuild will DELETE all ${snapshot.placesCount.toLocaleString()} row(s) in places and refetch from OpenStreetMap. PostgreSQL files persist on disk (bind mounts) until you delete them or run this rebuild.`
        : 'places is empty — rebuild will load POIs from OpenStreetMap from scratch.';
  } catch (err) {
    snapshot.placesCount = null;
    snapshot.placesQueryable = false;
    snapshot.placesCountError = err && err.message ? err.message : String(err);
    snapshot.hasExistingPlacesData = null;
    snapshot.wipeWarning =
      'Could not read places row count. A full rebuild still runs DELETE FROM places — confirm only if you intend to wipe and repopulate map POIs.';
  }

  for (const { key, table } of [
    { key: 'airportsCount', table: 'airports' },
    { key: 'notesCount', table: 'notes' },
  ]) {
    try {
      const r = await query(`SELECT COUNT(*)::bigint AS c FROM ${table}`);
      snapshot[key] = Number(r.rows[0].c);
    } catch {
      snapshot[key] = null;
    }
  }

  return snapshot;
}

function rebuildWipeRequiresConfirm(snapshot, clearPlaces) {
  if (clearPlaces === false) return false;
  if (!snapshot.placesQueryable || snapshot.placesCount === null) return true;
  return snapshot.placesCount > 0;
}

module.exports = {
  rebuildInventory,
  startRebuildInventory,
  startSelectiveRefresh,
  getRebuildInventoryState,
  getRebuildInventoryDataSnapshot,
  rebuildWipeRequiresConfirm,
  SELECTIVE_REFRESH_ORDER,
  VALID_REFRESH_TARGETS,
};
