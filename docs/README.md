## Documentation Overview

This folder contains reference and architecture docs for the Jamaica Parish Explorer backend, status board, and data integrations.

## Table of Contents

- [Startup guide](./STARTUP-GUIDE.md)
- [Database and map data](./DATABASE-AND-MAP-DATA.md)
- [SQLite → PostgreSQL migration](./DATA-MIGRATION-SQLITE-TO-POSTGRES.md)
- [Build process](./BUILD-PROCESS.md)
- [Build process diagram](./BUILD-PROCESS-DIAGRAM.md)
- [API reference](./API-REFERENCE.md)
- [Admin site](./ADMIN-SITE.md)
- [Status board](./STATUS-BOARD.md)
- [Status board diagram](./STATUS-BOARD-DIAGRAM.md)
- [Weather and wave data](./WEATHER-AND-WAVE-DATA.md)
- [Weather and waves diagram](./WEATHER-WAVES-DIAGRAM.md)
- [Flight data](./FLIGHT-DATA.md)
- [Flight data diagram](./FLIGHT-DATA-DIAGRAM.md)
- [Vessel data and usage](./VESSEL-DATA-AND-USAGE.md)
- [Vessel data diagram](./VESSEL-DATA-DIAGRAM.md)

### Setup and operations

- [`STARTUP-GUIDE.md`](./STARTUP-GUIDE.md) — how to run the app in every mode: dev (Vite HMR), PM2 production, Docker Compose, and bare `npm start`. Includes port reference and common troubleshooting.
- [`BUILD-PROCESS.md`](./BUILD-PROCESS.md) — how the client (Vite), server (native deps), database (init scripts), and Docker image (multi-stage) are built. Covers `JAMAICA_DATA_DIR`, `pmx: 'false'`, and layer caching.
- [`BUILD-PROCESS-DIAGRAM.md`](./BUILD-PROCESS-DIAGRAM.md) — Mermaid diagrams: Docker multi-stage build flow, runtime port/process architecture (including admin → API **database backup/restore**), and `JAMAICA_DATA_DIR` resolution.
- [`DATABASE-AND-MAP-DATA.md`](./DATABASE-AND-MAP-DATA.md) — PostgreSQL tables for map data (`parishes`, `places`, `airports`), **data sources** (OSM/Overpass, static seeds, Wikipedia/DDG enrichment), **how to repopulate**, **Overpass env vars** (pacing, mirrors, delayed retry of failed categories), **schema-on-startup**, and a **Mermaid ingest-flow diagram**.
- [`DATA-MIGRATION-SQLITE-TO-POSTGRES.md`](./DATA-MIGRATION-SQLITE-TO-POSTGRES.md) — moving an old SQLite `jamaica.db` into PostgreSQL (pgloader, dump, or custom export).

### API reference

- [`API-REFERENCE.md`](./API-REFERENCE.md) — reference for public REST routes, health, and admin endpoints (restart, rebuild, **database backup/restore**), with parameters and responses. Interactive Swagger docs are served at `/api/docs` when enabled.

### Admin site

- [`ADMIN-SITE.md`](./ADMIN-SITE.md) — authenticated admin dashboard: **Operations** (PM2 + service restarts), **Map data rebuild**, **Database**; plus Swagger/Status Board/Client/Health quick links. Runs on port 5556.
- [`ADMIN-SITE-DIAGRAM.md`](./ADMIN-SITE-DIAGRAM.md) — Mermaid diagrams: client-app link resolution, login flow, PM2 restart proxy, **database backup/restore** (admin → API → `pg_dump` / `psql`), and **map data rebuild** (`dataSnapshot` row counts, **`confirmWipe`**, `CONFIRM_WIPE_REQUIRED`, background OSM ingest, retries; public **`mapDataRebuild`** without counts).

### Status board and monitoring

- [`STATUS-BOARD.md`](./STATUS-BOARD.md) — how the status board works, what it checks, how to run it, and how weather provider health is derived from `/api/health`.
- [`STATUS-BOARD-DIAGRAM.md`](./STATUS-BOARD-DIAGRAM.md) — Mermaid diagram of the status board architecture (browser → status server → API → external providers); **`/api/health`** includes **`mapDataRebuild`** for ops JSON.

### Weather and waves

- [`WEATHER-AND-WAVE-DATA.md`](./WEATHER-AND-WAVE-DATA.md) — details on where weather and marine data comes from, update intervals, and endpoint behavior.
- [`WEATHER-WAVES-DIAGRAM.md`](./WEATHER-WAVES-DIAGRAM.md) — Mermaid diagram showing how weather and wave data flows from external providers through caches to the map.

### Flights and vessels

- [`FLIGHT-DATA.md`](./FLIGHT-DATA.md) — how scheduled and live flight data is fetched, cached, and exposed via `/api/flights` and related endpoints.
- [`FLIGHT-DATA-DIAGRAM.md`](./FLIGHT-DATA-DIAGRAM.md) — Mermaid diagram of the flight data flow (external providers → backend cache → `/api/flights` → map and airport views).
- [`VESSEL-DATA-AND-USAGE.md`](./VESSEL-DATA-AND-USAGE.md) — AIS/vessel data sources, how `/api/vessels` works, and guidance for safe usage and API keys.
- [`VESSEL-DATA-DIAGRAM.md`](./VESSEL-DATA-DIAGRAM.md) — Mermaid diagram of the vessel data flow (AISStream.io → in-memory snapshot → `/api/vessels` → map and port cruise views).

### Conventions

- All diagrams are written in **Mermaid** and can be rendered by compatible Markdown viewers.
- Paths in examples are relative to the project root (e.g. `server/routes/weather.js`, `client/src/api/weather.js`).

