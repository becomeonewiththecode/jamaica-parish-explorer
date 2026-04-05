# Database and map data (repopulation guide)

This document describes **what** lives in the SQLite database for the map and explorer UI, **where** that data comes from, and **how** to repopulate it after a fresh server, empty volume, or corrupted `jamaica.db`.

---

## Database file location

- **Default (local / PM2):** `server/jamaica.db` (and optional WAL files next to it).
- **Docker Compose:** set `JAMAICA_DATA_DIR=/data` and mount a volume on `/data` so the DB and JSON caches persist; see [`deployment/docker-compose/README.md`](../deployment/docker-compose/README.md) and [`BUILD-PROCESS.md`](./BUILD-PROCESS.md).

Other persisted files in the same data directory (when using `JAMAICA_DATA_DIR`):

- `.flight-cache.json` — flight provider cache (not “map POIs”).
- `.weather-cache.json` — weather/wave cache.

---

## What the map and “items” use

| Data | SQLite tables | Role on the map / app |
|------|-----------------|------------------------|
| Parish boundaries & copy | `parishes`, `features` | GeoJSON on the client comes from static assets; DB holds parish metadata (names, descriptions, colours, feature lists). |
| Points of interest | `places` | Hotels, restaurants, beaches, attractions, etc. — loaded via `/api/places/...`. |
| Airports | `airports` | Airport markers and detail panels (KIN, MBJ, etc.). |

**Not** covered by “rebuild map data” in the admin UI (different lifecycles / sources):

- `notes` — user content.
- `flights`, `weather_forecasts`, `weather_events`, `cruise_ports`, `cruise_calls` — filled at runtime from external APIs and scrapers, not from the OSM rebuild pipeline.

---

## Data sources (authoritative)

### 1. Parishes and features (static, in repo)

- **Source:** JavaScript seed data in `server/db/init.js` (exported as `seedParishes` after schema apply).
- **Applied by:** `npm run db:init`, and automatically as part of a **full rebuild** (admin or `db:rebuild`).
- **External API:** none.

### 2. Places (OpenStreetMap)

- **Source:** [OpenStreetMap](https://www.openstreetmap.org/) data, queried through the **Overpass API** (`https://overpass-api.de/api/interpreter` by default).
- **Implementation:** `server/db/places-from-osm.js` — categories include tourist attractions, landmarks, restaurants, cafés, hotels, guest houses, hospitals, schools, beaches, worship, banks, fuel, parks, stadiums, nightlife, shopping, car rental, etc., within a Jamaica bounding box.
- **Parish assignment:** `client/public/jamaica-parishes.geojson` — point-in-polygon to map each OSM feature to a parish slug.
- **Applied by:**
  - **Incremental:** `npm run fetch:places` — `INSERT OR IGNORE` (does not wipe existing rows).
  - **Full replace of POIs:** Admin **Rebuild map data** or `npm run db:rebuild` — **deletes all `places` rows** then ingests again.
- **Rate limiting:** ~2 seconds between Overpass category requests (be polite to the public instance).

### 3. Airports (static metadata in repo)

- **Source:** Curated list in `server/db/seed-airports.js` (`AIRPORTS`).
- **Applied by:**
  - **With image crawling (slow, CLI):** `npm run seed:airports` — fetches og:image / Bing fallbacks per airport.
  - **Metadata only (fast):** optional checkbox on admin **Rebuild map data**, or `npm run db:rebuild:all` — `seedAirportsStatic` uses `INSERT OR REPLACE` with `image_url` null.

### 4. Optional enrichment (descriptions, links)

- **Source:** English Wikipedia summaries (`en.wikipedia.org` REST API), DuckDuckGo HTML for website discovery — see `server/db/enrich-places.js`.
- **Applied by:** `npm run enrich:places` (run **after** places exist; not part of the admin rebuild button).
- **Effect:** Adds/updates columns such as `description`, `image_url`, etc., on `places` where the script supports it.

---

## How to repopulate (procedures)

### First-time or empty database

From the project root:

```bash
npm run db:init
npm run fetch:places    # or use full rebuild below
npm run enrich:places   # optional
npm run seed:airports   # optional; or use static airport seed via rebuild with --airports
```

`db:init` runs `schema.sql` and seeds `parishes` / `features`.

### Full repopulation of map POIs (wipe `places` then OSM)

**When to use:** New server, new Docker volume, or you need a clean resync from OSM.

1. **Admin (recommended if the API is up):** open the admin dashboard → **Rebuild map data** (see [Admin site](./ADMIN-SITE.md)). Optionally check **Include airports**. Confirm the dialog — the job runs **in the background**; watch the status panel and API logs.
2. **CLI:**

```bash
npm run db:rebuild          # schema + parishes + clear places + OSM ingest
npm run db:rebuild:all      # same + static airport rows (no image crawl)
```

3. **Afterwards:** run `npm run enrich:places` on the server if you want Wikipedia/DDG enrichment again.

### Incremental OSM import (keep existing `places` rows)

```bash
npm run fetch:places
```

New OSM IDs are inserted; existing `osm_id` rows are left as-is (`INSERT OR IGNORE`).

### Check admin / API prerequisites

- **`ADMIN_RESTART_TOKEN`** in `server/.env` must match between processes that call protected endpoints (admin UI → API proxy uses this for rebuild and restart).
- The rebuild endpoint is documented alongside other admin routes in the running API; see Swagger at `/api/docs` if enabled.

---

## Implementation reference

| Piece | Path |
|--------|------|
| Schema | `server/db/schema.sql` |
| Parish seed | `server/db/init.js` (`applySchema`, `seedParishes`) |
| OSM ingest | `server/db/places-from-osm.js`, orchestration `server/db/rebuild-inventory.js` |
| CLI full rebuild | `server/db/rebuild-inventory-cli.js` |
| Incremental fetch CLI | `server/db/fetch-places.js` |
| Airports | `server/db/seed-airports.js` |
| Enrichment | `server/db/enrich-places.js` |
| Admin trigger | Proxies to `POST /api/admin/rebuild-inventory` (see `server/index.js`, `server/admin.js`) |

---

## Summary

- **Parishes / features:** repo static data via `db:init` or any full rebuild.
- **Map POIs (`places`):** **OpenStreetMap** via **Overpass**; full wipe + refill uses admin **Rebuild map data** or `npm run db:rebuild`.
- **Airports:** repo static list; optional fast seed during rebuild or `npm run seed:airports` for images.
- **Rich text/links on places:** `npm run enrich:places` (separate step, external Wikipedia / DuckDuckGo).

For operations-focused setup (ports, PM2, Docker), see [Startup guide](./STARTUP-GUIDE.md).
