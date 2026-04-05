#!/usr/bin/env node
/**
 * CLI: fetch OSM POIs into places (ON CONFLICT osm_id DO NOTHING).
 * For a full wipe + refill use the admin "Rebuild map data" or rebuild-inventory-cli.js.
 */
const { query, closePool } = require('./pg-query');
const { ensurePlacesTable, ingestPlacesFromOsm } = require('./places-from-osm');

async function main() {
  console.log('Fetching places from OpenStreetMap...\n');
  await ensurePlacesTable();
  await ingestPlacesFromOsm({ onLog: console.log, delayBetweenCategoriesMs: 2000 });

  const { rows: summary } = await query(`
    SELECT p.name, COUNT(pl.id)::bigint AS count
    FROM parishes p LEFT JOIN places pl ON p.id = pl.parish_id
    GROUP BY p.id, p.name ORDER BY count DESC
  `);

  console.log('\nPlaces per parish:');
  for (const row of summary) {
    console.log(`  ${row.name}: ${row.count}`);
  }

  await closePool();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
