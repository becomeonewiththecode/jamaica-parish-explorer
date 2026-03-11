CREATE TABLE IF NOT EXISTS parishes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    county      TEXT NOT NULL,
    population  TEXT NOT NULL,
    capital     TEXT NOT NULL,
    area        TEXT NOT NULL,
    description TEXT NOT NULL,
    fill_color  TEXT NOT NULL,
    svg_path    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS features (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    parish_id   INTEGER NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
    name        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    parish_id   INTEGER NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
    author      TEXT DEFAULT 'Anonymous',
    content     TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS places (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    parish_id   INTEGER NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
    osm_id      TEXT UNIQUE,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL,
    lat         REAL NOT NULL,
    lon         REAL NOT NULL,
    address     TEXT,
    phone       TEXT,
    website     TEXT,
    opening_hours TEXT,
    cuisine     TEXT,
    stars       INTEGER,
    fetched_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notes_parish ON notes(parish_id);
CREATE INDEX IF NOT EXISTS idx_features_parish ON features(parish_id);
CREATE INDEX IF NOT EXISTS idx_places_parish ON places(parish_id);
CREATE INDEX IF NOT EXISTS idx_places_category ON places(category);
CREATE INDEX IF NOT EXISTS idx_places_osm ON places(osm_id);
