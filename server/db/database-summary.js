const { query } = require('./pg-query');

/** Fixed table names only (no user input). */
const SUMMARY_TABLES = [
  'parishes',
  'places',
  'airports',
  'notes',
  'features',
  'flights',
  'cruise_ports',
  'cruise_calls',
];

/**
 * Cheap COUNT(*) per core table for admin / ops.
 * @returns {Promise<{ counts: Record<string, number|null>, tableErrors: Record<string, string>, isNonEmpty: boolean, hasContentData: boolean }>}
 */
async function getDatabaseSummary() {
  const counts = {};
  const tableErrors = {};
  let anySuccess = false;

  for (const table of SUMMARY_TABLES) {
    try {
      const r = await query(`SELECT COUNT(*)::bigint AS c FROM ${table}`);
      counts[table] = Number(r.rows[0].c);
      anySuccess = true;
    } catch (err) {
      counts[table] = null;
      tableErrors[table] = err && err.message ? err.message : String(err);
    }
  }

  if (!anySuccess) {
    const firstErr = tableErrors[SUMMARY_TABLES[0]] || 'Could not query database';
    const e = new Error(firstErr);
    e.code = 'DATABASE_UNREACHABLE';
    throw e;
  }

  const numeric = Object.values(counts).filter((n) => typeof n === 'number');
  const totalRows = numeric.reduce((a, b) => a + b, 0);
  const isNonEmpty = totalRows > 0;
  const hasContentData =
    (counts.places ?? 0) > 0 ||
    (counts.airports ?? 0) > 0 ||
    (counts.notes ?? 0) > 0 ||
    (counts.features ?? 0) > 0;

  return { counts, tableErrors, isNonEmpty, hasContentData };
}

module.exports = { getDatabaseSummary, SUMMARY_TABLES };
