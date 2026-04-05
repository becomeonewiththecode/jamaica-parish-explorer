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
docker compose -f deployment/docker-compose/docker-compose-build.yml down -v   # also deletes data volume
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

### Persistent data (`jamaica_data` volume)

The named volume is mounted at **`/data`** in the container (not `/app/server`). The API writes **`jamaica.db`**, **`.flight-cache.json`**, and **`.weather-cache.json`** there via **`JAMAICA_DATA_DIR=/data`**.

**Why:** Mounting a volume over **`/app/server`** replaced the image's **`node_modules`**, including **`better-sqlite3`** built for **Alpine (musl)**. Keeping code and dependencies in the image and persisting only `/data` avoids that.

**Upgrading from an older compose file** that used `jamaica_data:/app/server`: stop the stack, copy `jamaica.db` (and optional `*.json` caches) out of the old volume, then recreate the volume at `/data` and restart.

---

### Tips

- **`better-sqlite3` / `ld-linux-x86-64.so.2` errors** after changing Docker files: rebuild without cache:
  ```bash
  docker compose -f deployment/docker-compose/docker-compose-build.yml build --no-cache
  docker compose -f deployment/docker-compose/docker-compose-build.yml up -d
  ```
- **Build must run from the project root** (`docker compose -f deployment/docker-compose/docker-compose-build.yml …`), not from inside `deployment/docker-compose/`, because the build context is `../..` (the repo root).
