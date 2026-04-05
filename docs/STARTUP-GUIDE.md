# Startup Guide

This guide covers every way to run Jamaica Parish Explorer — from a quick local dev session to a production Docker Compose stack.

---

## Prerequisites

| Tool | Min version | Required for |
|------|-------------|-------------|
| Node.js | 20 LTS | All modes |
| npm | 10+ | All modes |
| Docker + Docker Compose | 24 / v2+ | Docker mode |
| PM2 | 5+ | PM2 production mode |

> **nvm users:** PM2 v6 injects an APM module that fails to load `libnode.so` when Node is built without `--shared` (nvm always is). `ecosystem.config.js` already sets `pmx: 'false'` for the API process to prevent this. If you upgrade PM2, verify the setting is still present.

---

## Mode 1 — Development (hot reload)

Best for: local feature work. Uses Vite's dev server (port 5173) with full hot-module replacement.

```bash
# Install all dependencies
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..

# Initialise the database (first time only)
npm run db:init         # schema + parish seed data
npm run fetch:places    # POIs from OpenStreetMap via Overpass (slow; see docs)
npm run enrich:places   # Wikipedia + website discovery for places (slow, optional)

# Full wipe + OSM repopulation, sources, and admin rebuild: see docs/DATABASE-AND-MAP-DATA.md

# Start API server + Vite dev server together
npm run dev
```

| Process | URL | Notes |
|---------|-----|-------|
| API server | `http://localhost:3001` | Auto-restarts on file save (`--watch`) |
| Client (Vite) | `http://localhost:5173` | Hot-module replacement |
| Status board | `http://localhost:5555` | `npm run dev:status` (separate terminal) |
| Admin dashboard | `http://localhost:5556` | `npm run dev:admin` (separate terminal) |

The API proxies Vite internally when `NODE_ENV=development` so `/api/*` and `/` both resolve correctly.

On **every** API process start, `server/index.js` applies **`schema.sql`**, runs **idempotent migrations** (e.g. missing `places` columns, `airports` table), and **seeds parishes** so Docker volumes and upgrades stay consistent without waiting for a manual rebuild. Map POIs are still refilled via **admin → Rebuild map data** or `npm run db:rebuild` (see [Database and map data](./DATABASE-AND-MAP-DATA.md)).

---

## Mode 2 — PM2 (production, bare metal / VM)

Best for: running on a Linux VM or your local machine in production mode. PM2 manages three processes and auto-restarts them on crash.

### First run

```bash
# Build the React client
npm run build

# Start all three processes from ecosystem.config.js
pm2 start ecosystem.config.js

# Persist so processes survive a system reboot
pm2 save
pm2 startup    # follow the printed systemd/launchd instructions
```

### Day-to-day

```bash
pm2 status                          # overview table
pm2 logs jamaica-api --lines 50     # tail API logs
pm2 restart jamaica-api             # restart one process
pm2 restart all                     # restart everything
pm2 stop all                        # stop everything (ports released)
```

| Process | Port | `ecosystem.config.js` name |
|---------|------|---------------------------|
| API + built client | 3001 | `jamaica-api` |
| Status board | 5555 | `jamaica-status` |
| Admin dashboard | 5556 | `jamaica-admin` |

The React client is served directly from `client/dist/` by Express — there is no Vite dev server in this mode. Access the app at `http://localhost:3001`.

### Environment variables

Create `server/.env` before starting (see `.env.example` for all keys):

```bash
NODE_ENV=production
PORT=3001
HOST=0.0.0.0
ADMIN_USER=admin
ADMIN_PASSWORD=<strong password>
ADMIN_RESTART_TOKEN=<random hex>
RAPIDAPI_KEY=...
OPENSKY_CLIENT_ID=...
OPENSKY_CLIENT_SECRET=...
AISSTREAM_API_KEY=...
```

> **ADMIN_PASSWORD is required.** `admin.js` refuses to start without it.

---

## Mode 3 — Docker Compose (production, single container)

Best for: reproducible production builds, or running the full stack without installing Node locally.

There are two compose files:

| File | When to use |
|------|-------------|
| `docker-compose-build.yml` | Build the image from local source (after code changes) |
| `docker-compose-prod.yml` | Pull a pre-built image from Docker Hub (`maxwayne/jamaica-explorer:1.0`) |

> **Important:** All `docker compose` commands must be run from the **project root**, not from inside `deployment/docker-compose/`. The build context is `../..` (the repo root).

### Option A — Build locally

```bash
# 1. Copy and fill in the environment file (only once)
cp deployment/docker-compose/.env.example deployment/docker-compose/.env
# Edit .env — at minimum set ADMIN_PASSWORD and any API keys you want

# 2. Build the image and start the stack
docker compose -f deployment/docker-compose/docker-compose-build.yml up -d --build

# 3. Follow logs while it initialises
docker compose -f deployment/docker-compose/docker-compose-build.yml logs -f
```

The build step (compiling native modules + React) typically takes **2–4 minutes** on first run. Subsequent `up --build` calls are faster because Docker caches layers.

### Option B — Pull from Docker Hub

```bash
# 1. Copy and fill in the environment file (only once)
cp deployment/docker-compose/.env.example deployment/docker-compose/.env
# Edit .env — at minimum set ADMIN_PASSWORD and any API keys you want

# 2. Pull the image and start the stack
docker compose -f deployment/docker-compose/docker-compose-prod.yml up -d

# 3. Follow logs while it initialises
docker compose -f deployment/docker-compose/docker-compose-prod.yml logs -f
```

### Port mapping

Configured via `HOST_PORT` in `.env` (default `80`):

| Service | Host port | Container port |
|---------|-----------|----------------|
| App + API | `HOST_PORT` (e.g. 80 or 4001) | 3001 |
| Status board | `STATUS_PORT` (default 5555) | 5555 |
| Admin dashboard | `ADMIN_PORT` (default 5556) | 5556 |

With `HOST_PORT=4001`, the app is at `http://<host>:4001`.

### Day-to-day (build mode)

```bash
docker compose -f deployment/docker-compose/docker-compose-build.yml logs -f
docker compose -f deployment/docker-compose/docker-compose-build.yml logs jamaica-parish-explorer
docker compose -f deployment/docker-compose/docker-compose-build.yml restart
docker compose -f deployment/docker-compose/docker-compose-build.yml down
docker compose -f deployment/docker-compose/docker-compose-build.yml down
# Reset DB/caches: rm -rf deployment/docker-compose/data/postgres deployment/docker-compose/data/jamaica
docker compose -f deployment/docker-compose/docker-compose-build.yml up -d --build  # rebuild and restart
```

### Persistent data

**PostgreSQL** data and **JSON caches** use **bind mounts** under **`deployment/docker-compose/data/`** (paths relative to the compose file): **`data/postgres`** → Postgres, **`data/jamaica`** → **`/data`** (`JAMAICA_DATA_DIR`). Application code and `node_modules` stay in the image.

**Easiest:** use the admin dashboard (**`ADMIN_PORT`**, default **5556**) → **Database backup & restore** (downloads `.sql` or uploads a dump with a **`RESTORE`** confirmation; see [`ADMIN-SITE.md`](./ADMIN-SITE.md)).

**CLI:** back up with `pg_dump` (from the host or a throwaway client container), not by copying Postgres data directories raw. Example if Postgres is reachable on the compose network:

```bash
docker exec jamaica-parish-explorer ls /data
# pg_dump — from a client with DATABASE_URL, or: docker compose exec postgres pg_dump -U jamaica jamaica > backup.sql
```

See [`DATA-MIGRATION-SQLITE-TO-POSTGRES.md`](./DATA-MIGRATION-SQLITE-TO-POSTGRES.md) if you are moving from an old SQLite `jamaica.db`.

### Seeding the database inside Docker

The image does **not** run the seed scripts automatically. To seed after the first start:

```bash
docker exec jamaica-parish-explorer sh -c "cd /app/server && node db/init.js"
docker exec jamaica-parish-explorer sh -c "cd /app/server && node db/fetch-places.js"
docker exec jamaica-parish-explorer sh -c "cd /app/server && node db/enrich-places.js"
```

For a **full repopulation** of map POIs (clear `places` then Overpass ingest), use the admin **Rebuild map data** button (API must be running; the UI shows row counts and sends **`confirmWipe`** when data exists) or run `node db/rebuild-inventory-cli.js` inside the container from `/app/server`. See [Database and map data](./DATABASE-AND-MAP-DATA.md) for sources and tables.

### Stopping and switching back to PM2

```bash
docker compose -f deployment/docker-compose/docker-compose-build.yml down   # free ports 3001/5555/5556
pm2 start ecosystem.config.js
```

---

## Mode 4 — `npm start` (bare production, no PM2)

Starts only the API server (which also serves the built client). No status board or admin dashboard.

```bash
npm run build   # build the React client first
npm start       # runs: cd server && NODE_ENV=production node index.js
```

App available at `http://localhost:3001`. Pair with a process supervisor (systemd, Docker, etc.) for reliability.

---

## Quick reference — ports

| Port | Service | Dev | PM2 | Docker | npm start |
|------|---------|-----|-----|--------|-----------|
| 3001 | API + built client | ✓ | ✓ | ✓ (internal) | ✓ |
| 5173 | Vite dev client | ✓ | — | — | — |
| 5555 | Status board | optional | ✓ | ✓ | — |
| 5556 | Admin dashboard | optional | ✓ | ✓ | — |
| `HOST_PORT` | Exposed app (Docker) | — | — | ✓ | — |

---

## Troubleshooting

### `ECONNREFUSED 127.0.0.1:3001`
The API is not running. In PM2 mode run `pm2 status`; in Docker mode run `docker compose -f deployment/docker-compose/docker-compose-build.yml ps`.

### `ERR_DLOPEN_FAILED` / `libnode.so` on PM2 restart
PM2 v6's APM module tries to load `libnode.so`, which doesn't exist on nvm-managed Node. Verify `ecosystem.config.js` has `pmx: 'false'` in the `jamaica-api` env block.

### Database connection errors (`DATABASE_URL`, `ECONNREFUSED` to Postgres)
Ensure the **`postgres`** service is healthy and **`DATABASE_URL`** in the app container matches the Compose network hostname (usually `postgres`), user, password, and database name. Check logs: `docker compose … logs postgres` and `… logs jamaica-parish-explorer`.

### Port already in use
Stop PM2 before starting Docker (or vice versa): `pm2 stop all` before `docker compose … up`.

### Admin dashboard won't start — "ADMIN_PASSWORD is required"
Set `ADMIN_PASSWORD` in `server/.env` (PM2/bare) or `deployment/docker-compose/.env` (Docker).
