## Docker Compose: Single-server deployment

This option runs the full Jamaica Parish Explorer stack in a single Docker container on one server using `docker-compose`.

### Files

- `Dockerfile` — builds a production image for the full app (server + built client)
- `docker-compose.yml` — defines the service, ports, and volume for persistent data
- `.env.example` — template for environment variables (copy to `.env` before use)

### Usage

```bash
cd deployment/docker-compose

# 1. Create your environment file
cp .env.example .env
edit .env

# 2. Build and start the stack
docker compose up -d --build

# 3. View logs
docker compose logs -f

# 4. Stop the stack
docker compose down
```

> **Tip:** If you see `ld-linux-x86-64.so.2` / `better-sqlite3` errors after changing Docker files, rebuild without cache: `docker compose build --no-cache && docker compose up -d`.

By default, the app is exposed on port 80 of the host (`HOST_PORT`), forwarding to port 3001 in the container (`PORT`). You can change these via the `.env` file.

### Persistent data (`jamaica_data` volume)

The named volume is mounted at **`/data`** in the container (not `/app/server`). The API writes **`jamaica.db`**, **`.flight-cache.json`**, and **`.weather-cache.json`** there via **`JAMAICA_DATA_DIR=/data`**.

**Why:** Mounting a volume over **`/app/server`** replaced the image’s **`node_modules`**, including **`better-sqlite3`** built for **Alpine (musl)**. If that volume ever contained **glibc** binaries from the host (or a different OS), Node failed with `ld-linux-x86-64.so.2: No such file or directory`. Keeping code and dependencies in the image and persisting only `/data` avoids that.

**Upgrading from an older compose file** that used `jamaica_data:/app/server`: stop the stack, copy `jamaica.db` (and optional `*.json` caches) out of the old volume if you need them, recreate the volume or copy those files into a new mount at `/data`, then `docker compose up -d --build`.

