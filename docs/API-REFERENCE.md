# API Reference

Interactive Swagger documentation is available at **`/api/docs`** when the API server is running (default: `http://localhost:3001/api/docs/`). The raw OpenAPI 3.0 spec is at `/api/docs.json`.

This document provides a quick reference for all API endpoints.

---

## Health & Admin

### `GET /api/health`

Server health check used by the status board. Returns uptime, provider health snapshots, and **map-data OSM rebuild** status (no auth).

| Field | Description |
|-------|-------------|
| `ok` | Always `true` if the server is responding |
| `uptime` | Server uptime in seconds |
| `env` | `NODE_ENV` value |
| `providers` | Weather provider health (Open-Meteo, WeatherAPI, OpenWeatherMap) |
| `waveProviders` | Wave/marine provider health |
| `flightProviders` | Flight provider health (AeroDataBox, RapidAPI, OpenSky, adsb.lol) |
| `mapDataRebuild` | Snapshot of the background **Rebuild map data** job: `inProgress`, `phase`, `progressPercent`, `currentStepLabel`, `lastStartedAt`, `lastFinishedAt`, `lastError`, `lastSummary` (e.g. `totalPlaces`, `osmStillFailedAfterRetries`), `sections` (per-category `status`, `httpStatus`, `found`, …), `includeAirportsPlanned`. Same data as `GET /api/admin/rebuild-inventory/status` but reachable without admin token for monitoring. |

### `POST /api/admin/restart`

Triggers a PM2 process restart. Requires `X-Admin-Token` header matching `ADMIN_RESTART_TOKEN` in `server/.env`.

| Parameter | In | Description |
|-----------|----|-------------|
| `X-Admin-Token` | header | Admin secret token (required) |
| `target` | body | `"api"`, `"status"`, or `"all"` (default `"all"`) |

Returns `403` if token is missing or invalid.

If `target` is `api` or `all`, the API server may rebuild the React client in production (only when it detects that `client/` source files are newer than `client/dist/`). The JSON response includes `clientBuildRebuilt` and (when a rebuild occurs) a truncated `clientBuild` output.

### `GET /api/admin/database/backup`

Downloads a **plain SQL** dump of the PostgreSQL database (`pg_dump` with `--clean --if-exists --no-owner --no-acl`). Requires `X-Admin-Token` matching `ADMIN_RESTART_TOKEN`. The API host must have **`pg_dump`** on `PATH` (e.g. `postgresql-client` in Docker).

**Response:** `200` with `Content-Disposition: attachment` and SQL body, or `403` / `503` (client tools missing) / `500` with JSON on failure before streaming starts.

### `POST /api/admin/database/restore`

Restores from an uploaded **plain SQL** backup. Requires `X-Admin-Token`. **Multipart form:** field **`backup`** (file), field **`confirm`** must be exactly **`RESTORE`**. Runs **`psql`** with `ON_ERROR_STOP` against `DATABASE_URL` / `POSTGRES_*`.

**Limits:** default max upload **512 MiB**; override with **`ADMIN_DB_RESTORE_MAX_BYTES`** on the API server.

**Response:** `200` `{ ok: true, message }` on success, or `400` / `403` / `413` / `500` with `detail` (stderr) on failure.

**Admin site (port 5556):** authenticated session proxies these as **`GET /api/database/backup`** and **`POST /api/database/restore`** (no admin token in the browser — the admin process adds `X-Admin-Token` when calling the API).

---

## Parishes

### `GET /api/parishes`

Lightweight list of all 14 parishes for map rendering.

**Response:** Array of `{ slug, name, county, fill_color, svg_path }`

### `GET /api/parishes/:slug`

Full parish detail with features.

| Parameter | In | Description |
|-----------|----|-------------|
| `slug` | path | Parish slug (e.g. `st-james`, `kingston`) |

**Response:** Parish object with all columns plus `features` array.
Returns `404` if parish not found.

---

## Notes

### `GET /api/parishes/:slug/notes`

Returns all user-submitted notes for a parish, newest first.

| Parameter | In | Description |
|-----------|----|-------------|
| `slug` | path | Parish slug |

**Response:** Array of `{ id, author, content, created_at }`

### `POST /api/parishes/:slug/notes`

Creates a new note for a parish.

| Parameter | In | Description |
|-----------|----|-------------|
| `slug` | path | Parish slug |
| `content` | body | Note content (required) |
| `author` | body | Author name (optional, defaults to "Anonymous", max 50 chars) |

**Response:** `201` with the created note object. Returns `400` if content is empty, `404` if parish not found.

### `DELETE /api/notes/:id`

Deletes a note by ID.

| Parameter | In | Description |
|-----------|----|-------------|
| `id` | path | Note ID |

Returns `404` if note not found.

---

## Places

### `GET /api/places/search?q=...`

Search places by name. Returns up to 10 results, prioritizing prefix matches.

| Parameter | In | Description |
|-----------|----|-------------|
| `q` | query | Search query (min 2 characters) |

**Response:** Array of `{ id, name, category, lat, lon, parish_slug, parish_name }`

### `GET /api/places/categories`

List all place categories with counts, sorted by count descending.

**Response:** Array of `{ category, count }`

### `GET /api/places/all`

Lightweight list of all places for map overlay. Optionally filter by category.

| Parameter | In | Description |
|-----------|----|-------------|
| `category` | query | Filter by category (e.g. `restaurant`, `hotel`) |

**Response:** Array of `{ id, name, category, lat, lon }`

### `GET /api/parishes/:slug/places`

All places for a parish with full detail. Optionally filter by category.

| Parameter | In | Description |
|-----------|----|-------------|
| `slug` | path | Parish slug |
| `category` | query | Filter by category |

**Response:** Array of place objects with full detail (address, phone, website, opening_hours, cuisine, stars, description, image_url, menu_url, tiktok_url, instagram_url, booking_url, tripadvisor_url).
Returns `404` if parish not found.

### `GET /api/places/website-image?url=...`

Extracts `og:image` or `twitter:image` meta tag from a given URL.

| Parameter | In | Description |
|-----------|----|-------------|
| `url` | query | Website URL to extract image from (required) |

**Response:** `{ image: string | null }`

---

## Airports

### `GET /api/airports`

Returns all Jamaican airports with parsed `historical_facts`.

**Response:** Array of airport objects.

### `GET /api/airports/:code`

Returns a single airport by IATA code.

| Parameter | In | Description |
|-----------|----|-------------|
| `code` | path | IATA code (e.g. `KIN`, `MBJ`, `OCJ`, `KTP`) |

Returns `404` if airport not found.

---

## Flights

### `GET /api/flights`

Returns the current flight snapshot — both scheduled (AeroDataBox) and live radar (adsb.lol, OpenSky) data merged together.

**Response:**
| Field | Description |
|-------|-------------|
| `flights` | Array of flight objects with status confirmation |
| `source` | Data source info (`"loading"` if first fetch hasn't completed) |
| `time` | Unix timestamp |
| `airports` | Array of Jamaica airports with coordinates |
| `livePollIntervalSeconds` | How often live data is polled |
| `liveRadiusNm` | Radar search radius in nautical miles |

### `GET /api/flights/history`

Query stored flight records from the database.

| Parameter | In | Description |
|-----------|----|-------------|
| `airport` | query | Filter by airport IATA code |
| `direction` | query | `arrival` or `departure` |
| `limit` | query | Max results (default `100`) |

**Response:** `{ flights: array, total: number }`

---

## Weather

### `GET /api/weather?lat=...&lon=...`

Aggregated current weather from multiple providers for a specific coordinate.

| Parameter | In | Description |
|-----------|----|-------------|
| `lat` | query | Latitude (required) |
| `lon` | query | Longitude (required) |

Returns `400` if lat/lon invalid, `502` if all weather services are unavailable.

### `GET /api/weather/parish/:slug`

Current weather for a parish using its capital city coordinates.

| Parameter | In | Description |
|-----------|----|-------------|
| `slug` | path | Parish slug (e.g. `st-james`, `kingston`) |

Returns `404` for unknown parish, `502` if weather unavailable.

### `GET /api/weather/island`

Island-wide weather for all 14 parishes. Cached for ~10 minutes. Used by the map weather layer.

**Response:** Array of parish weather objects, each including `slug`, `lat`, `lon`, and weather fields. Parishes where weather fetch failed include `{ error: true, description: "Unavailable" }`.

### `GET /api/weather/waves`

Wave conditions at 13 coastal points around Jamaica. Sourced from Open-Meteo Marine.

**Response:** Array of `{ id, name, lat, lon, waveHeight, waveDirection, wavePeriod }`

### `GET /api/weather/events`

Active and upcoming bad-weather events (storms, warnings, etc.).

| Parameter | In | Description |
|-----------|----|-------------|
| `type` | query | Filter by event type |
| `parish` | query | Filter by parish slug |

**Response:** Array of weather event objects with id, type, source, severity, headline, description, parish_slug, area, starts_at, ends_at.

---

## Vessels

### `GET /api/vessels`

AIS vessel positions near Jamaica. Includes globally tracked ships when `TRACKED_SHIP_MMSIS` is configured.

| Parameter | In | Description |
|-----------|----|-------------|
| `type` | query | `all` (default) or `cruise` |

**Response:** `{ vessels: array, count: number, lastUpdate: ISO string }`

---

## Cruises

### `GET /api/ports/:id/cruises`

Upcoming cruise ship calls for a Jamaican port. Data is scraped from CruiseMapper/CruiseDig and cached for 6 hours.

| Parameter | In | Description |
|-----------|----|-------------|
| `id` | path | Port ID: `montego-bay-cruise-port`, `ocho-rios-cruise-port`, or `falmouth-cruise-port` |

**Response:** `{ portId: string, cruises: array }`
Returns `404` for unknown port ID.

---

## Implementation

- **Swagger setup:** `server/swagger.js` — configures `swagger-jsdoc` to scan all route files for JSDoc annotations and serves the UI via `swagger-ui-express`.
- **Route files:** Each endpoint has a `@swagger` JSDoc block above its handler in the corresponding route file under `server/routes/`.
- **OpenAPI spec:** Available at `/api/docs.json` for programmatic access or import into tools like Postman.
