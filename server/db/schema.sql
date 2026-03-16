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

CREATE TABLE IF NOT EXISTS flights (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    flight_number   TEXT NOT NULL,
    airport         TEXT NOT NULL,
    status          TEXT NOT NULL,
    direction       TEXT NOT NULL CHECK(direction IN ('arrival', 'departure')),
    airline         TEXT,
    aircraft        TEXT,
    aircraft_reg    TEXT,
    route           TEXT,
    route_iata      TEXT,
    route_country   TEXT,
    scheduled_time  TEXT,
    callsign        TEXT,
    fetched_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_flights_airport ON flights(airport);
CREATE INDEX IF NOT EXISTS idx_flights_direction ON flights(direction);
CREATE INDEX IF NOT EXISTS idx_flights_fetched ON flights(fetched_at);

CREATE INDEX IF NOT EXISTS idx_notes_parish ON notes(parish_id);
CREATE INDEX IF NOT EXISTS idx_features_parish ON features(parish_id);
CREATE INDEX IF NOT EXISTS idx_places_parish ON places(parish_id);
CREATE INDEX IF NOT EXISTS idx_places_category ON places(category);
CREATE INDEX IF NOT EXISTS idx_places_osm ON places(osm_id);

-- Cruise ports (logical ports used for schedules and AIS-linked cruise data)
CREATE TABLE IF NOT EXISTS cruise_ports (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    code            TEXT UNIQUE NOT NULL, -- e.g. 'montego-bay-cruise-port'
    name            TEXT NOT NULL,
    city            TEXT,
    country         TEXT DEFAULT 'Jamaica',
    lat             REAL,
    lon             REAL,
    source_url      TEXT,                 -- CruiseDig / CruiseMapper URL when applicable
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

-- Cruise calls (scheduled or observed cruise ship visits)
CREATE TABLE IF NOT EXISTS cruise_calls (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    port_id             INTEGER NOT NULL REFERENCES cruise_ports(id) ON DELETE CASCADE,
    ship_name           TEXT NOT NULL,
    operator            TEXT,
    mmsi                TEXT,             -- when known from AISStream.io
    source              TEXT NOT NULL,    -- 'CruiseDig', 'CruiseMapper', 'AIS', etc.
    eta_local_text      TEXT,             -- human-readable ETA scraped from sites
    eta_utc             TEXT,             -- normalized UTC timestamp (optional)
    arrival_window_from TEXT,             -- optional derived arrival window start (UTC)
    arrival_window_to   TEXT,             -- optional derived arrival window end (UTC)
    status              TEXT DEFAULT 'scheduled', -- 'scheduled','observed','cancelled','departed'
    first_seen_at       TEXT,             -- when AIS first saw the vessel near this port
    last_seen_at        TEXT,             -- last AIS observation near this port
    created_at          TEXT DEFAULT (datetime('now')),
    updated_at          TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cruise_ports_code ON cruise_ports(code);
CREATE INDEX IF NOT EXISTS idx_cruise_calls_port ON cruise_calls(port_id);
CREATE INDEX IF NOT EXISTS idx_cruise_calls_ship ON cruise_calls(ship_name);
CREATE INDEX IF NOT EXISTS idx_cruise_calls_eta ON cruise_calls(eta_utc);
