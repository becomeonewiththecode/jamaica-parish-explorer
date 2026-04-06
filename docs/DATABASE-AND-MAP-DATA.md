# Database and map data (repopulation guide)

This document describes **what** lives in the **PostgreSQL** database for the map and explorer UI, **where** that data comes from, and **how** to repopulate it after a fresh server or empty database. Legacy SQLite (`jamaica.db`) is no longer used by the app; see [`DATA-MIGRATION-SQLITE-TO-POSTGRES.md`](./DATA-MIGRATION-SQLITE-TO-POSTGRES.md) if you need to import an old file.

---

## Connection and data directory

- **PostgreSQL:** set **`DATABASE_URL`** (e.g. `postgresql://user:pass@host:5432/jamaica`) in `server/.env`. The API uses the `pg` pool from `server/db/pg-query.js`.
- **Docker Compose:** a `postgres` service and `DATABASE_URL` pointing at it are defined in the compose files under `deployment/docker-compose/`.
- **`JAMAICA_DATA_DIR`:** optional directory for **JSON caches only** (not the primary database):

  - `.flight-cache.json` — flight provider cache (not “map POIs”).
  - `.weather-cache.json` — weather/wave cache.

See [`deployment/docker-compose/README.md`](../deployment/docker-compose/README.md) and [`BUILD-PROCESS.md`](./BUILD-PROCESS.md).

### Two different folders on disk (Compose)

| Path (next to the compose file) | Role |
|---------------------------------|------|
| **`data/postgres`** | **PostgreSQL cluster** — all relational tables (`parishes`, `features`, `places`, …). |
| **`data/jamaica`** | **`JAMAICA_DATA_DIR`** — **only** `.flight-cache.json` and `.weather-cache.json`. |

Deleting **`data/jamaica`** clears flight/weather caches; it **does not** empty Postgres. To wipe the database you must remove **`data/postgres`** (or drop the DB), then restart — see [Why parishes and features reappear](#why-parishes-and-features-reappear-after-a-wipe) below.

A diagram of this split is in [`BUILD-PROCESS-DIAGRAM.md`](./BUILD-PROCESS-DIAGRAM.md) (**Two persistence layers**).

---

## Why parishes and features reappear after a wipe

On **every API startup**, `server/index.js` runs **`applySchema()`** then **`seedParishes()`** (see `server/db/init.js`). That step:

- Ensures **14** rows in **`parishes`** (one per parish; `INSERT … ON CONFLICT DO NOTHING` for new slugs, or existing rows left as-is on first insert path).
- Inserts **five landmark names per parish** into **`features`** when a parish has **no** feature rows yet — **14 × 5 = 70** rows total from the bundled seed.

So after you delete **`data/postgres`** and start fresh, the admin **Database** tab can still show **14 parishes** and **70 features** immediately: that is **expected seeded metadata**, not leftover files from `data/jamaica`. **`places`**, **airports**, **notes**, flights, and cruise tables stay empty until you ingest or refresh them separately.

---

## Backup and restore (PostgreSQL)

- **Admin UI (recommended when the stack is up):** log in to the admin dashboard (default port **5556**) → **Database** tab. Download produces a plain **`.sql`** file (`pg_dump` with `--clean --if-exists --no-owner --no-acl`). Upload restore requires typing **`RESTORE`** in the confirmation field; it runs **`psql`** with `ON_ERROR_STOP` and can **overwrite or drop** existing objects — treat backups as sensitive and test restores on a copy first.
- **API (automation):** `GET /api/admin/database/backup` and `POST /api/admin/database/restore` with header **`X-Admin-Token`** matching **`ADMIN_RESTART_TOKEN`** (same secret as restart/rebuild). Max upload size defaults to **512 MiB**; set **`ADMIN_DB_RESTORE_MAX_BYTES`** to override.
- **Prerequisites:** the API process host must have **`pg_dump`** and **`psql`** on `PATH` (Docker images install **`postgresql-client`**). If tools are missing, the API returns **503** for backup.
- **CLI alternative:** `pg_dump` / `psql` from any machine that can reach Postgres — see [Startup guide](./STARTUP-GUIDE.md) (Docker section).

Full request/response details: [`API-REFERENCE.md`](./API-REFERENCE.md). UX and proxy paths: [`ADMIN-SITE.md`](./ADMIN-SITE.md).

---

## What the map and “items” use

| Data | Tables | Role on the map / app |
|------|-----------------|------------------------|
| Parish boundaries & copy | `parishes`, `features` | GeoJSON on the client comes from static assets; DB holds parish metadata (names, descriptions, colours, feature lists). |
| Points of interest | `places` | Hotels, restaurants, beaches, attractions, etc. — loaded via `/api/places/...`. |
| Airports | `airports` | Airport markers and detail panels (KIN, MBJ, etc.). |

**Selective refresh** on the admin **Map data rebuild** tab can target individual areas (parishes metadata, feature lists, OSM **places**, static airports, flight provider pull, cruise ports/schedules, or clearing **`notes`**). A **full** rebuild without a `targets` array (e.g. CLI `db:rebuild`) still runs the legacy pipeline: schema, parish seed, wipe **places**, OSM ingest, optional airports.

**Not** filled by OSM ingest alone (different lifecycles / sources):

- `notes` — user content (optional **Clear all user notes** in admin).
- `flights`, `weather_forecasts`, `weather_events`, `cruise_ports`, `cruise_calls` — runtime APIs/scrapers; admin can trigger **Flights** / **Cruise** checkboxes to refresh.

---

## Data sources (authoritative)

### 1. Parishes and features (static, in repo)

- **Source:** JavaScript seed data in `server/db/init.js` (`seedParishes`, plus **`upsertParishesFromSeed`** / **`resyncFeaturesFromSeed`** for admin selective refresh).
- **Applied by:** **`npm run db:init`**, **every API process start** (`applySchema` + `seedParishes` in `server/index.js`), **full** admin/OSM rebuild, and optional admin checkboxes (**Parishes** / **Features**) on the **Map data rebuild** tab.
- **External API:** none.

### 2. Places (OpenStreetMap)

- **Source:** [OpenStreetMap](https://www.openstreetmap.org/) data, queried through the **Overpass API**. The client rotates across several public interpreter endpoints (see env vars below); you can override the list.
- **Implementation:** `server/db/places-from-osm.js` — categories include tourist attractions, landmarks, restaurants, cafés, hotels, guest houses, hospitals, schools, beaches, worship, banks, fuel, parks, stadiums, nightlife, shopping, car rental, etc., within a Jamaica bounding box.
- **Parish assignment:** `client/public/jamaica-parishes.geojson` — point-in-polygon to map each OSM feature to a parish slug.
- **Applied by:**
  - **Incremental:** `npm run fetch:places` — `INSERT … ON CONFLICT (osm_id) DO NOTHING` (does not overwrite existing rows).
  - **Full replace of POIs:** Admin **Rebuild map data** or `npm run db:rebuild` — **deletes all `places` rows** then ingests again.
- **Pacing and resilience (public Overpass):**
  - **Between categories (main pass):** default **12 seconds** (`OVERPASS_CATEGORY_DELAY_MS`). Older docs mentioned ~2s; that was too aggressive and caused **HTTP 429** (rate limit) and **504** (timeouts).
  - **Per request:** failed calls with **429**, **502**, **503**, **504**, or network errors are retried with backoff and mirror rotation, up to `OVERPASS_MAX_ATTEMPTS` (default **12**).
  - **After the main pass:** steps that failed with a **retriable** status (not **400** bad query) are queued for **delayed retry round(s)** only for those indices — default **one** round after **120s** (`OVERPASS_FAILED_ROUND_DELAY_MS`), with **35s** between retries (`OVERPASS_RETRY_CATEGORY_DELAY_MS`) and extra attempts (`OVERPASS_RETRY_ROUND_MAX_ATTEMPTS`). Set `OVERPASS_FAILED_RETRY_ROUNDS=0` to disable, or `2`–`4` for more waves (cooldown grows each wave).
- **Schema on API boot:** `server/index.js` runs `applySchema` + `seedParishes` at startup so tables/columns exist and **parish + feature seed rows** are present **before** any client traffic (`server/db/schema.postgresql.sql` + idempotent column checks in `init.js`).

### 3. Airports (static metadata in repo)

- **Source:** Curated list in `server/db/seed-airports.js` (`AIRPORTS`).
- **Applied by:**
  - **With image crawling (slow, CLI):** `npm run seed:airports` — fetches og:image / Bing fallbacks per airport.
  - **Metadata only (fast):** optional checkbox on admin **Rebuild map data**, or `npm run db:rebuild:all` — `seedAirportsStatic` uses `INSERT … ON CONFLICT (code) DO UPDATE` with `image_url` preserved where appropriate.

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

**When to use:** New server, empty Compose `data/` directories, or you need a clean resync from OSM.

1. **Admin (recommended if the API is up):** open the admin dashboard → **Map data rebuild** tab (see [Admin site](./ADMIN-SITE.md)). Use the **section checkboxes** to refresh only what you need (parishes metadata, feature lists, OSM **places**, static airports, flight provider pull, cruise ports / schedules, or — with a second confirm — **clear all user notes**). The banner shows live **`places`** / **`airports`** / **`notes`** counts from **`dataSnapshot`**. OSM still requires **`confirmWipe: true`** when POI rows would be deleted; **`confirmClearNotes: true`** is required to wipe **`notes`**. Optionally use **After OSM, seed airports**. The job runs **in the background**; watch the status panel and API logs.
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

- **`ADMIN_RESTART_TOKEN`** in `server/.env` must match between processes that call protected endpoints (admin UI → API proxy uses this for rebuild, restart, and **database backup/restore**).
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

`GET /api/health` includes a **`mapDataRebuild`** object with the same **job** fields as the admin status endpoint (`inProgress`, `phase`, `progressPercent`, `currentStepLabel`, per-category **`sections`**, `lastSummary`, etc.) but **without** the admin-only **`dataSnapshot`** row counts. Use it for ops dashboards and alerting; it does not expose secrets.

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
| Schema (PostgreSQL) | `server/db/schema.postgresql.sql` (`applySchema` in `server/db/init.js`; legacy `schema.sql` may exist for reference) |
| Parish + feature seed | `server/db/init.js` — `applySchema`, `seedParishes` (API boot in `server/index.js`); `upsertParishesFromSeed`, `resyncFeaturesFromSeed` (selective refresh) |
| OSM ingest | `server/db/places-from-osm.js`, orchestration `server/db/rebuild-inventory.js` (`rebuildInventory`, `selectiveDataRefresh`) |
| CLI full rebuild | `server/db/rebuild-inventory-cli.js` |
| Incremental fetch CLI | `server/db/fetch-places.js` |
| Airports | `server/db/seed-airports.js` |
| Cruise port upsert | `server/db/cruise-schedules.js` (`seedDefaultCruisePorts`) |
| Enrichment | `server/db/enrich-places.js` |
| Admin map rebuild | `POST /api/admin/rebuild-inventory` — optional **`targets`** (selective) or legacy full rebuild; `confirmWipe` / `confirmClearNotes` as needed. `GET …/rebuild-inventory/status` includes `dataSnapshot`. See `server/index.js`, `server/admin.js`, `server/db/rebuild-inventory.js`. |
| Admin DB row counts | `GET /api/admin/database/summary` — `server/db/database-summary.js`; admin proxy `GET /api/database/summary` |
| Admin DB backup/restore | API: `server/routes/admin-database.js` — `GET/POST /api/admin/database/*`; admin proxy: `GET/POST /api/database/*` in `server/admin.js` |

---

## Summary

- **Parishes / features:** repo static data via `db:init` or any full rebuild.
- **Schema:** applied on **every API startup** (`applySchema` + migrations + `seedParishes`), not only during rebuild.
- **Map POIs (`places`):** **OpenStreetMap** via **Overpass**; full wipe + refill uses admin **Rebuild map data** or `npm run db:rebuild`. Ingest uses **slow pacing**, **mirror rotation**, **retries**, and an optional **failed-only delayed retry round**.
- **Airports:** repo static list; optional fast seed during rebuild or `npm run seed:airports` for images.
- **Rich text/links on places:** `npm run enrich:places` (separate step, external Wikipedia / DuckDuckGo).
- **Observability:** **`GET /api/health`** → **`mapDataRebuild`** for live rebuild progress without the admin token.
- **Backups:** admin **Database** tab (backup & restore) or direct `pg_dump` — see [Backup and restore](#backup-and-restore-postgresql) above.

For operations-focused setup (ports, PM2, Docker), see [Startup guide](./STARTUP-GUIDE.md).
