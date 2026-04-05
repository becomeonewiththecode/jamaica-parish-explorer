# Build Process

> See also: [`BUILD-PROCESS-DIAGRAM.md`](./BUILD-PROCESS-DIAGRAM.md) for Mermaid diagrams of the Docker build stages, runtime process architecture, and `JAMAICA_DATA_DIR` resolution flow.

Explains how the client, server, database, and Docker image are built, and what happens at each step.

---

## Overview

```
project_jamaica/
├── client/          React app — compiled by Vite into client/dist/
├── server/          Node.js/Express — no compile step, runs directly
├── server/jamaica.db  SQLite — seeded by init scripts, not checked in
└── deployment/      Dockerfile(s) for Docker / Kubernetes
```

The server is plain CommonJS and runs directly with Node. Only the **React client** requires a build step. The **Docker image** wraps both in a multi-stage build.

---

## 1. Client build (Vite)

### What it does

Vite bundles `client/src/` into `client/dist/`:

```
client/dist/
├── index.html
├── assets/
│   ├── index-[hash].js     # bundled React app
│   └── index-[hash].css    # all styles
└── ...                     # public/ files copied verbatim
```

### How to run it

```bash
npm run build
# equivalent to: cd client && npm run build
```

### Environment variables baked at build time

Vite reads `client/.env` (or shell env) at build time. Variables prefixed `VITE_` are inlined into the JS bundle — they cannot be changed after the build without rebuilding.

| Variable | Purpose |
|----------|---------|
| `VITE_THUNDERFOREST_API_KEY` | Optional. Enables Thunderforest map tile layers (Transport, Landscape, Neighbourhood). If absent, those layers are hidden. |

> **Docker note:** The Dockerfile `COPY`s the project files and then runs the build inside the image. To bake `VITE_THUNDERFOREST_API_KEY` into a Docker image, set it in `deployment/docker-compose/.env` before running `docker compose -f deployment/docker-compose/docker-compose-build.yml up --build`. The Compose file does not pass it as a Docker build arg — if that's needed, add a `build.args` entry to `docker-compose-build.yml` and a matching `ARG` in the Dockerfile.

### How Express serves the built client

In production (`NODE_ENV=production`), `server/index.js` serves `client/dist/` as static files and falls back to `client/dist/index.html` for all non-API routes (SPA routing):

```js
// server/index.js (simplified)
app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});
```

In development (`NODE_ENV=development`), the Vite dev server (port 5173) serves the client with HMR instead.

---

## 2. Server (no build step)

The server is CommonJS and runs directly — no TypeScript, no transpilation.

```bash
node server/index.js          # bare start
npm start                     # production (sets NODE_ENV=production)
npm run dev:server            # development (node --watch for auto-restart)
```

### Key files

| File | Purpose |
|------|---------|
| `server/index.js` | Express entry point — mounts all routes, starts listen |
| `server/db/connection.js` | Opens SQLite via `better-sqlite3`, enables WAL mode |
| `server/data-dir.js` | Resolves `JAMAICA_DATA_DIR` env var for DB + cache file paths |
| `server/routes/` | One file per feature group (parishes, places, flights, weather, vessels, ports) |
| `server/status-board.js` | Standalone Express app on port 5555 |
| `server/admin.js` | Standalone Express app on port 5556 |

### Native dependency: better-sqlite3

`better-sqlite3` compiles a native `.node` binary during `npm install`. The binary is tied to the exact Node.js ABI version and CPU architecture. This means:

- `npm install` must be run on the **same platform** that will run the code.
- In Docker, `npm install` runs **inside the Alpine container** during the build stage so the binary targets musl/Alpine, not the host's glibc.
- Never copy `server/node_modules/` from a Linux host into an Alpine Docker image (or vice versa) — the binary will fail to load.

### Data directory (`JAMAICA_DATA_DIR`)

`server/data-dir.js` centralises where runtime data is written:

```js
function getDataDir() {
  const raw = process.env.JAMAICA_DATA_DIR;
  if (raw && raw.trim()) return path.resolve(raw.trim());
  return path.join(__dirname);   // defaults to server/
}
```

| Scenario | Default path | Override |
|----------|-------------|---------|
| Dev / PM2 bare | `server/` | `JAMAICA_DATA_DIR=/some/path` in `server/.env` |
| Docker Compose | `/data` (volume) | Set in `docker-compose-build.yml` / `docker-compose-prod.yml` env block |
| Kubernetes | `/data` (PVC mount) | Set in `deployment.yaml` env block |

Files written there:
- `jamaica.db` — SQLite database
- `.flight-cache.json` — cached scheduled flight data
- `.weather-cache.json` — cached island weather data (all 14 parishes)
- `.wave-cache.json` — cached coastal wave data

---

## 3. Database initialisation

The SQLite database is **not included in the repo** and must be seeded before the server can serve parish or place data.

### Scripts (run from project root)

```bash
npm run db:init         # 1. Create schema + seed 14 parish rows (fast, ~1 s)
npm run fetch:places    # 2. Fetch ~4,300 POIs from OpenStreetMap Overpass API (slow, ~5–15 min)
npm run enrich:places   # 3. Add Bing images + Wikipedia descriptions (slow, ~20–60 min)
npm run seed:airports   # Optional: re-seed airport metadata
```

Run these in order on first setup. Steps 2 and 3 can be skipped if you copy in an existing `jamaica.db`.

### Where the database ends up

- **Dev/PM2:** `server/jamaica.db`
- **Docker:** `/data/jamaica.db` (inside the named volume `jamaica_data`)
- **Kubernetes:** `/data/jamaica.db` (inside the PVC mount)

---

## 4. Docker image build (multi-stage)

Both the Docker Compose and Kubernetes Dockerfiles use the same two-stage pattern.

### Stage 1: `build` (node:20-alpine)

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++ git   # native module build tools
COPY . .
RUN rm -rf node_modules client/node_modules server/node_modules  # strip host binaries
RUN npm install && cd server && npm install && cd ../client && npm install && cd .. && npm run build
```

What happens:
1. Build tools (python3, make, g++) are installed — required by `better-sqlite3` to compile its native addon.
2. Any `node_modules/` that arrived via `COPY` are deleted — prevents glibc host binaries leaking into the musl Alpine image.
3. `npm install` installs root deps (just `concurrently`).
4. `cd server && npm install` installs server deps including `better-sqlite3`, compiled fresh for Alpine.
5. `npm run build` runs Vite (`cd client && npm run build`) to produce `client/dist/`.

### Stage 2: `runtime` (node:20-alpine)

```dockerfile
FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache sqlite && npm install -g pm2   # Docker Compose variant
COPY --from=build /app /app
ENV NODE_ENV=production PORT=3001
EXPOSE 3001 5555 5556
CMD ["pm2-runtime", "ecosystem.config.js"]   # Docker Compose
# CMD ["npm", "start"]                        # Kubernetes variant
```

What happens:
1. A fresh Alpine image is used — no build tools, smaller image.
2. `sqlite` CLI is installed (useful for `docker exec` database inspection).
3. PM2 is installed globally (Docker Compose variant only).
4. Everything from the build stage is copied in — compiled `node_modules` and `client/dist/`.
5. The container starts via `pm2-runtime` (Compose) or `npm start` (Kubernetes).

### Why two stages?

The build stage needs `python3`, `make`, `g++`, and `git` (~150 MB of build tools). The runtime stage doesn't. Multi-stage keeps the final image lean and avoids shipping compilers into production.

### Layer caching

Docker caches layers. The most expensive steps (`npm install`, native compile, Vite build) are cached as long as:
- `package.json` / `package-lock.json` files don't change (for `npm install`)
- Source files don't change (for the Vite build)

If you change a source file, only the `COPY . .` layer and everything after it is invalidated. The `apk add` and `npm install -g pm2` layers are reused.

If native modules fail with a shared-library error, force a full rebuild:

```bash
docker compose -f deployment/docker-compose/docker-compose-build.yml build --no-cache
docker compose -f deployment/docker-compose/docker-compose-build.yml up -d
```

---

## 5. PM2 inside Docker (`pm2-runtime`)

Docker Compose uses `pm2-runtime` instead of a bare `node` command. `pm2-runtime` is PM2's container-aware mode:

- Runs in the **foreground** (no daemonise), so Docker tracks the process correctly.
- Reads `ecosystem.config.js` to launch `jamaica-api`, `jamaica-status`, and `jamaica-admin` as child processes.
- Forwards signals (`SIGINT`, `SIGTERM`) from Docker to child processes for graceful shutdown.
- Streams all child process logs to stdout/stderr, visible via `docker compose -f … logs`.

The `pmx: 'false'` flag in `ecosystem.config.js` disables PM2's APM/`@pm2/io` hook for `jamaica-api`. This is required because the hook tries to open `libnode.so` (the Node shared library), which does not exist in standard Node builds. Without it, `jamaica-api` crashes immediately on start with `ERR_DLOPEN_FAILED`.

---

## 6. Build summary / cheat sheet

| Task | Command |
|------|---------|
| Install all deps (first time) | `npm install && cd server && npm install && cd ../client && npm install` |
| Build React client | `npm run build` |
| Initialise database | `npm run db:init` |
| Seed places (OSM) | `npm run fetch:places` |
| Enrich places (Bing/Wiki) | `npm run enrich:places` |
| Start dev (API + Vite) | `npm run dev` |
| Start production (PM2) | `pm2 start ecosystem.config.js` |
| Start production (Docker, build) | `docker compose -f deployment/docker-compose/docker-compose-build.yml up -d --build` |
| Start production (Docker, pull) | `docker compose -f deployment/docker-compose/docker-compose-prod.yml up -d` |
| Rebuild Docker (no cache) | `docker compose -f deployment/docker-compose/docker-compose-build.yml build --no-cache && … up -d` |
| Stop Docker | `docker compose -f deployment/docker-compose/docker-compose-build.yml down` |
| Stop PM2 | `pm2 stop all` |
