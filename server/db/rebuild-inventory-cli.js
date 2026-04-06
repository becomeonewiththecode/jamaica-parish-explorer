#!/usr/bin/env node
/** One-off full rebuild from shell (closes pool when done). */
const { closePool } = require('./pg-query');
const { rebuildInventory } = require('./rebuild-inventory');

const includeAirports = process.argv.includes('--airports');

rebuildInventory({
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
    closePool().catch((e) => console.error(e));
  });
