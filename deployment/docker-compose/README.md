## Docker Compose: Single-server deployment

This option runs the full Jamaica Parish Explorer stack in a single Docker container on one server using `docker compose`.

There are two compose files depending on whether you are building the image locally or pulling a pre-built image from Docker Hub.

### Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Builds a production image (server + compiled client, Alpine/musl) |
| `docker-compose-build.yml` | Builds the image locally from source and starts the stack |
| `docker-compose-prod.yml` | Pulls the pre-built image from Docker Hub and starts the stack |
| `.env.example` | Template for environment variables (copy to `.env` before use) |

---

### Option A — Build locally (`docker-compose-build.yml`)

Use this when you want to build the image from your local source tree (e.g. after making code changes).

> **Run from the project root** — the build context must be the repo root so the Dockerfile can access `package.json`, `client/`, and `server/`.

```bash
# 1. Create your environment file (only once)
cp deployment/docker-compose/.env.example deployment/docker-compose/.env
# Edit .env — set ADMIN_PASSWORD, API keys, HOST_PORT, etc.

# 2. Build the image and start the stack
docker compose -f deployment/docker-compose/docker-compose-build.yml up -d --build

# 3. Follow logs
docker compose -f deployment/docker-compose/docker-compose-build.yml logs -f
```

---

### Option B — Pull from Docker Hub (`docker-compose-prod.yml`)

Use this on a server where you just want to run a published image without a local source checkout.

```bash
# 1. Create your environment file (only once)
cp deployment/docker-compose/.env.example deployment/docker-compose/.env
# Edit .env — set ADMIN_PASSWORD, API keys, HOST_PORT, etc.

# 2. Pull the image and start the stack
docker compose -f deployment/docker-compose/docker-compose-prod.yml up -d

# 3. Follow logs
docker compose -f deployment/docker-compose/docker-compose-prod.yml logs -f
```

The image is `maxwayne/jamaica-explorer:1.0`. Update the tag in `docker-compose-prod.yml` when a new version is published.

---

### Day-to-day commands

Replace `-f docker-compose-build.yml` with `-f docker-compose-prod.yml` depending on which mode you are using.

```bash
docker compose -f deployment/docker-compose/docker-compose-build.yml logs -f
docker compose -f deployment/docker-compose/docker-compose-build.yml restart
docker compose -f deployment/docker-compose/docker-compose-build.yml down
docker compose -f deployment/docker-compose/docker-compose-build.yml down
# To wipe persisted DB + caches, remove bind-mount dirs next to the compose file:
# rm -rf deployment/docker-compose/data/postgres deployment/docker-compose/data/jamaica
docker compose -f deployment/docker-compose/docker-compose-build.yml up -d --build  # rebuild and restart
```

---

### Port mapping

Configured via `HOST_PORT` in `.env` (default `80`):

| Service | Host port | Container port |
|---------|-----------|----------------|
| App + API | `HOST_PORT` (e.g. 80 or 4001) | 3001 |
| Status board | `STATUS_PORT` (default 5555) | 5555 |
| Admin dashboard | `ADMIN_PORT` (default 5556) | 5556 |

---

### Persistent data (bind mounts)

Paths are **relative to each compose file** (`deployment/docker-compose/`), so data stays next to the stack definition:

| Host path (created on first start) | Container | Purpose |
|------------------------------------|-----------|---------|
| `./data/postgres` | `/var/lib/postgresql/data` | PostgreSQL cluster data |
| `./data/jamaica` | `/data` | **`JAMAICA_DATA_DIR`** — **`.flight-cache.json`**, **`.weather-cache.json`** only |

**Important:** removing **`data/jamaica`** does **not** reset the SQL database. Row counts for **`parishes`** / **`features`** / **`places`** etc. live under **`data/postgres`**. The API also runs **`seedParishes()`** on every start, so a fresh Postgres volume often shows **14** parishes and **70** features (seeded landmark lists) before you run OSM ingest — see [`docs/DATABASE-AND-MAP-DATA.md`](../../docs/DATABASE-AND-MAP-DATA.md).

The app still connects to Postgres via **`POSTGRES_HOST=postgres`** (or **`DATABASE_URL`**); credentials match **`POSTGRES_*`** in `.env`.

**Why `/data` on the app container instead of `/app/server`:** mounting over **`/app/server`** would replace the image’s **`node_modules`**.

These directories are listed in **`.gitignore`** at the repo root so database and cache files are not committed.

**Backups:** use the admin UI (**`ADMIN_PORT`**, mapped like the status board) → **Database** tab, or run `pg_dump` against the `postgres` service — see [`docs/DATABASE-AND-MAP-DATA.md`](../../docs/DATABASE-AND-MAP-DATA.md). This stack uses **PostgreSQL 16** by default; SQL dumps produced by **PG 17+** clients may contain `SET transaction_timeout`, which the API strips on restore so imports still work.

**Upgrading from SQLite-era compose** that stored `jamaica.db` on `/data`: migrate data with [`docs/DATA-MIGRATION-SQLITE-TO-POSTGRES.md`](../../docs/DATA-MIGRATION-SQLITE-TO-POSTGRES.md), then rely on Postgres for all relational data.

---

### Tips

- After changing Dockerfiles or dependencies, rebuild without cache if the image looks stale:
  ```bash
  docker compose -f deployment/docker-compose/docker-compose-build.yml build --no-cache
  docker compose -f deployment/docker-compose/docker-compose-build.yml up -d
  ```
- **Build must run from the project root** (`docker compose -f deployment/docker-compose/docker-compose-build.yml …`), not from inside `deployment/docker-compose/`, because the build context is `../..` (the repo root).
