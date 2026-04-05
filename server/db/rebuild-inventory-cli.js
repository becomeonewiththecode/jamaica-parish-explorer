#!/usr/bin/env node
/** One-off full rebuild from shell (closes DB when done). */
const db = require('./connection');
const { rebuildInventory } = require('./rebuild-inventory');

const includeAirports = process.argv.includes('--airports');

rebuildInventory(db, {
  includeAirports,
  onLog: console.log,
})
  .then((summary) => {
    console.log('\nRebuild finished:', summary);
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    db.close();
  });
