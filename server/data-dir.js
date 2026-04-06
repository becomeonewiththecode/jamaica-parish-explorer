const path = require('path');

/**
 * Directory for disk caches (.flight-cache.json, .weather-cache.json).
 * Relational data lives in PostgreSQL (`DATABASE_URL`). In Docker, set
 * JAMAICA_DATA_DIR=/data and mount a volume there so node_modules from the image
 * is not replaced by a volume.
 */
function getDataDir() {
  const raw = process.env.JAMAICA_DATA_DIR;
  if (raw && String(raw).trim()) return path.resolve(String(raw).trim());
  return path.join(__dirname);
}

module.exports = { getDataDir };
