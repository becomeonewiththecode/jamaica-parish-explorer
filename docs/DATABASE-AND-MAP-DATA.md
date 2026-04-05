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

- **Source:** [OpenStreetMap](https://www.openstreetmap.org/) data, queried through the **Overpass API**. The client rotates across several public interpreter endpoints (see env vars below); you can override the list.
- **Implementation:** `server/db/places-from-osm.js` — categories include tourist attractions, landmarks, restaurants, cafés, hotels, guest houses, hospitals, schools, beaches, worship, banks, fuel, parks, stadiums, nightlife, shopping, car rental, etc., within a Jamaica bounding box.
- **Parish assignment:** `client/public/jamaica-parishes.geojson` — point-in-polygon to map each OSM feature to a parish slug.
- **Applied by:**
  - **Incremental:** `npm run fetch:places` — `INSERT OR IGNORE` (does not wipe existing rows).
  - **Full replace of POIs:** Admin **Rebuild map data** or `npm run db:rebuild` — **deletes all `places` rows** then ingests again.
- **Pacing and resilience (public Overpass):**
  - **Between categories (main pass):** default **12 seconds** (`OVERPASS_CATEGORY_DELAY_MS`). Older docs mentioned ~2s; that was too aggressive and caused **HTTP 429** (rate limit) and **504** (timeouts).
  - **Per request:** failed calls with **429**, **502**, **503**, **504**, or network errors are retried with backoff and mirror rotation, up to `OVERPASS_MAX_ATTEMPTS` (default **12**).
  - **After the main pass:** steps that failed with a **retriable** status (not **400** bad query) are queued for **delayed retry round(s)** only for those indices — default **one** round after **120s** (`OVERPASS_FAILED_ROUND_DELAY_MS`), with **35s** between retries (`OVERPASS_RETRY_CATEGORY_DELAY_MS`) and extra attempts (`OVERPASS_RETRY_ROUND_MAX_ATTEMPTS`). Set `OVERPASS_FAILED_RETRY_ROUNDS=0` to disable, or `2`–`4` for more waves (cooldown grows each wave).
- **Schema on API boot:** `server/index.js` runs `applySchema` + `seedParishes` at startup so `places` enrichment columns and the `airports` table exist **before** any rebuild — avoids `SqliteError: no such column/table` on fresh volumes.

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

### Overpass-related environment variables (optional)

| Variable | Default | Purpose |
|----------|---------|---------|
| `OVERPASS_ENDPOINTS` | *(built-in list of 3 interpreters)* | Comma-separated Overpass `/api/interpreter` URLs |
| `OVERPASS_CATEGORY_DELAY_MS` | `12000` | Pause between **main-pass** category fetches |
| `OVERPASS_MAX_ATTEMPTS` | `12` | Max HTTP attempts per category (main pass), with backoff |
| `OVERPASS_FAILED_ROUND_DELAY_MS` | `120000` | Wait **before** starting a **failed-only** retry round (ms) |
| `OVERPASS_RETRY_CATEGORY_DELAY_MS` | `35000` | Pause between fetches **inside** a retry round |
| `OVERPASS_FAILED_RETRY_ROUNDS` | `1` | Number of delayed retry waves (`0` = off, max `4`) |
| `OVERPASS_RETRY_ROUND_MAX_ATTEMPTS` | `max(12, 18)` | Per-request attempts during retry rounds |

### Monitoring rebuild status (no admin token)

`GET /api/health` includes a **`mapDataRebuild`** object (same shape as the admin status payload): `inProgress`, `phase`, `progressPercent`, `currentStepLabel`, per-category **`sections`**, `lastSummary`, etc. Use it for ops dashboards and alerting; it does not expose secrets.

---

## OSM ingest flow (diagram)

```mermaid
flowchart TD
  subgraph Main["Main pass (all 19 queries)"]
    A[For each category] --> B[POST Overpass — rotate mirrors on failure]
    B --> C{HTTP OK?}
    C -->|yes| D[INSERT OR IGNORE into places]
    C -->|429/504/…| E[Backoff + retry / next mirror]
    E --> B
    C -->|400| F[Skip retries — bad query]
    D --> G[Sleep OVERPASS_CATEGORY_DELAY_MS]
    G --> A
  end

  Main --> H{Any retriable failures?}
  H -->|no| Z[Done]
  H -->|yes| W[Sleep OVERPASS_FAILED_ROUND_DELAY_MS]
  W --> R["Retry pass — only failed indices"]
  R --> T[Slower pacing + OVERPASS_RETRY_ROUND_MAX_ATTEMPTS]
  T --> Z

  classDef ok fill:#064e3b,stroke:#4ade80,color:#f0fdf4;
  classDef warn fill:#422006,stroke:#f59e0b,color:#fffbeb;
  class Z ok;
  class F warn;
```

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
- **Schema:** applied on **every API startup** (`applySchema` + migrations + `seedParishes`), not only during rebuild.
- **Map POIs (`places`):** **OpenStreetMap** via **Overpass**; full wipe + refill uses admin **Rebuild map data** or `npm run db:rebuild`. Ingest uses **slow pacing**, **mirror rotation**, **retries**, and an optional **failed-only delayed retry round**.
- **Airports:** repo static list; optional fast seed during rebuild or `npm run seed:airports` for images.
- **Rich text/links on places:** `npm run enrich:places` (separate step, external Wikipedia / DuckDuckGo).
- **Observability:** **`GET /api/health`** → **`mapDataRebuild`** for live rebuild progress without the admin token.

For operations-focused setup (ports, PM2, Docker), see [Startup guide](./STARTUP-GUIDE.md).
