const { applySchema, seedParishes } = require('./init');
const { ensurePlacesTable, ingestPlacesFromOsm } = require('./places-from-osm');
const { seedAirportsStatic } = require('./seed-airports');

const state = {
  inProgress: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: null,
  lastSummary: null,
};

/**
 * Full rebuild: schema, parishes, clear places, OSM ingest, optional static airports.
 * Uses the shared DB handle — do not call db.close() after this.
 */
async function rebuildInventory(db, options = {}) {
  const onLog = options.onLog || ((m) => console.log(`[rebuild-inventory] ${m}`));

  onLog('Applying SQL schema…');
  applySchema(db);
  onLog('Ensuring parish seed data…');
  seedParishes(db);
  ensurePlacesTable(db);

  if (options.clearPlaces !== false) {
    db.prepare('DELETE FROM places').run();
    onLog('Cleared places table.');
  }

  onLog('Ingesting places from OpenStreetMap (this takes several minutes)…');
  const osm = await ingestPlacesFromOsm(db, {
    onLog,
    delayBetweenCategoriesMs: options.delayBetweenCategoriesMs ?? 2000,
  });

  let airportCount = null;
  if (options.includeAirports) {
    onLog('Seeding airports (metadata only, no image crawl)…');
    seedAirportsStatic(db);
    airportCount = db.prepare('SELECT COUNT(*) as c FROM airports').get().c;
  }

  return {
    totalPlaces: osm.totalPlaces,
    totalInsertedAttempt: osm.totalInserted,
    categoriesFetched: osm.categories,
    airports: airportCount,
  };
}

/**
 * Fire-and-forget background job (HTTP should respond immediately).
 */
function startRebuildInventory(db, options, callback) {
  if (state.inProgress) {
    if (typeof callback === 'function') callback(new Error('A rebuild is already in progress'));
    return false;
  }

  state.inProgress = true;
  state.lastError = null;
  state.lastSummary = null;
  state.lastStartedAt = new Date().toISOString();
  state.lastFinishedAt = null;

  rebuildInventory(db, options)
    .then((summary) => {
      state.lastSummary = summary;
      state.lastError = null;
      state.lastFinishedAt = new Date().toISOString();
      callback(null, summary);
    })
    .catch((err) => {
      state.lastError = err && err.message ? err.message : String(err);
      state.lastSummary = null;
      state.lastFinishedAt = new Date().toISOString();
      callback(err, null);
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
  };
}

module.exports = {
  rebuildInventory,
  startRebuildInventory,
  getRebuildInventoryState,
};
