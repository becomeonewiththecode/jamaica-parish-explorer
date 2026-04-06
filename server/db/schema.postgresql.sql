-- PostgreSQL schema (Jamaica Parish Explorer). Applied on API startup / migrations.

CREATE TABLE IF NOT EXISTS parishes (
    id          BIGSERIAL PRIMARY KEY,
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
    id          BIGSERIAL PRIMARY KEY,
    parish_id   BIGINT NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
    name        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
    id          BIGSERIAL PRIMARY KEY,
    parish_id   BIGINT NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
    author      TEXT DEFAULT 'Anonymous',
    content     TEXT NOT NULL,
    created_at  TEXT DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS places (
    id          BIGSERIAL PRIMARY KEY,
    parish_id   BIGINT NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
    osm_id      TEXT UNIQUE,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL,
    lat         DOUBLE PRECISION NOT NULL,
    lon         DOUBLE PRECISION NOT NULL,
    address     TEXT,
    phone       TEXT,
    website     TEXT,
    opening_hours TEXT,
    cuisine     TEXT,
    stars       INTEGER,
    description   TEXT,
    image_url     TEXT,
    menu_url      TEXT,
    tiktok_url    TEXT,
    instagram_url TEXT,
    booking_url   TEXT,
    tripadvisor_url TEXT,
    fetched_at  TEXT DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS flights (
    id              BIGSERIAL PRIMARY KEY,
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
    fetched_at      TEXT DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE INDEX IF NOT EXISTS idx_flights_airport ON flights(airport);
CREATE INDEX IF NOT EXISTS idx_flights_direction ON flights(direction);
CREATE INDEX IF NOT EXISTS idx_flights_fetched ON flights(fetched_at);

CREATE INDEX IF NOT EXISTS idx_notes_parish ON notes(parish_id);
CREATE INDEX IF NOT EXISTS idx_features_parish ON features(parish_id);
CREATE INDEX IF NOT EXISTS idx_places_parish ON places(parish_id);
CREATE INDEX IF NOT EXISTS idx_places_category ON places(category);
CREATE INDEX IF NOT EXISTS idx_places_osm ON places(osm_id);

CREATE TABLE IF NOT EXISTS airports (
    id          BIGSERIAL PRIMARY KEY,
    code        TEXT UNIQUE NOT NULL,
    icao        TEXT NOT NULL,
    name        TEXT NOT NULL,
    short_name  TEXT NOT NULL,
    type        TEXT NOT NULL,
    lat         DOUBLE PRECISION NOT NULL,
    lon         DOUBLE PRECISION NOT NULL,
    parish_slug TEXT NOT NULL,
    named_after TEXT NOT NULL,
    opened      TEXT NOT NULL,
    elevation   TEXT NOT NULL,
    runway      TEXT NOT NULL,
    operator    TEXT NOT NULL,
    serves      TEXT NOT NULL,
    website     TEXT,
    image_url   TEXT,
    historical_facts TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cruise_ports (
    id              BIGSERIAL PRIMARY KEY,
    code            TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    city            TEXT,
    country         TEXT DEFAULT 'Jamaica',
    lat             DOUBLE PRECISION,
    lon             DOUBLE PRECISION,
    source_url      TEXT,
    created_at      TEXT DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')),
    updated_at      TEXT DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS cruise_calls (
    id                  BIGSERIAL PRIMARY KEY,
    port_id             BIGINT NOT NULL REFERENCES cruise_ports(id) ON DELETE CASCADE,
    ship_name           TEXT NOT NULL,
    operator            TEXT,
    mmsi                TEXT,
    source              TEXT NOT NULL,
    eta_local_text      TEXT,
    eta_utc             TEXT,
    arrival_window_from TEXT,
    arrival_window_to   TEXT,
    status              TEXT DEFAULT 'scheduled',
    first_seen_at       TEXT,
    last_seen_at        TEXT,
    created_at          TEXT DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')),
    updated_at          TEXT DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE INDEX IF NOT EXISTS idx_cruise_ports_code ON cruise_ports(code);
CREATE INDEX IF NOT EXISTS idx_cruise_calls_port ON cruise_calls(port_id);
CREATE INDEX IF NOT EXISTS idx_cruise_calls_ship ON cruise_calls(ship_name);
CREATE INDEX IF NOT EXISTS idx_cruise_calls_eta ON cruise_calls(eta_utc);

CREATE TABLE IF NOT EXISTS weather_forecasts (
    id          BIGSERIAL PRIMARY KEY,
    parish_slug TEXT NOT NULL,
    city_id     TEXT NOT NULL,
    source      TEXT NOT NULL,
    lat         DOUBLE PRECISION NOT NULL,
    lon         DOUBLE PRECISION NOT NULL,
    date        TEXT NOT NULL,
    temp_min    DOUBLE PRECISION,
    temp_max    DOUBLE PRECISION,
    temp_mean   DOUBLE PRECISION,
    humidity    DOUBLE PRECISION,
    description TEXT,
    raw_json    TEXT,
    fetched_at  TEXT DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')),
    UNIQUE (parish_slug, city_id, source, date)
);

CREATE INDEX IF NOT EXISTS idx_weather_forecasts_city_date
    ON weather_forecasts(parish_slug, city_id, date);

CREATE TABLE IF NOT EXISTS weather_events (
    id          BIGSERIAL PRIMARY KEY,
    type        TEXT NOT NULL,
    source      TEXT NOT NULL,
    event_id    TEXT,
    severity    TEXT,
    headline    TEXT,
    description TEXT,
    parish_slug TEXT,
    area        TEXT,
    starts_at   TEXT,
    ends_at     TEXT,
    fetched_at  TEXT DEFAULT (to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE INDEX IF NOT EXISTS idx_weather_events_time
    ON weather_events(ends_at, starts_at);

CREATE INDEX IF NOT EXISTS idx_weather_events_parish
    ON weather_events(parish_slug);
