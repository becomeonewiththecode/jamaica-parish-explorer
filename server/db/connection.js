const Database = require('better-sqlite3');
const path = require('path');
const { getDataDir } = require('../data-dir');

const db = new Database(path.join(getDataDir(), 'jamaica.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = db;
