#!/usr/bin/env node
/**
 * CLI: fetch OSM POIs into places (incremental INSERT OR IGNORE).
 * For a full wipe + refill use the admin "Rebuild map data" or rebuild-inventory-cli.js.
 */
const db = require('./connection');
const { ensurePlacesTable, ingestPlacesFromOsm } = require('./places-from-osm');

async function main() {
  console.log('Fetching places from OpenStreetMap...\n');
  ensurePlacesTable(db);
  await ingestPlacesFromOsm(db, { onLog: console.log, delayBetweenCategoriesMs: 2000 });

  const summary = db
    .prepare(
      `
    SELECT p.name, COUNT(pl.id) as count
    FROM parishes p LEFT JOIN places pl ON p.id = pl.parish_id
    GROUP BY p.id ORDER BY count DESC
  `
    )
    .all();

  console.log('\nPlaces per parish:');
  for (const row of summary) {
    console.log(`  ${row.name}: ${row.count}`);
  }

  db.close();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
