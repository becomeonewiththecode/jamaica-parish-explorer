# Admin Site

The admin site is an authenticated dashboard for managing the Jamaica Parish Explorer application. It consolidates monitoring, documentation, and remote control into a single interface behind a login wall.

---

## What it provides

- **Quick links** to Swagger API docs, Status Board, Client App, and the Health endpoint (open in new tabs). The **Client App** link is resolved dynamically: it points to the Vite dev server (`CLIENT_PORT`, default 5173) when that server is reachable, and falls back to the production app URL (served by Express on `API_PORT`) when Vite is offline.
- **PM2 process table** showing all managed processes with status, CPU, memory, restarts, and uptime. Auto-refreshes every 30 seconds.
- **Restart controls** — buttons to restart the API server, Status Board, Admin site, or all PM2 processes. Proxies to the API server's `POST /api/admin/restart` endpoint with the `X-Admin-Token` header.
- **Database backup & restore** — download a PostgreSQL **`.sql`** dump (`pg_dump` via `GET /api/database/backup` → API `GET /api/admin/database/backup`), or upload a backup with a **`RESTORE`** confirmation field (`POST /api/database/restore` → API `POST /api/admin/database/restore`). Requires **`ADMIN_RESTART_TOKEN`** on both admin and API; the API image should include **`postgresql-client`**. Restore overwrites existing database objects (destructive).
- **Map data rebuild** — same dashboard card as **Restart Controls** (below the PM2 restart buttons): clears the `places` table and refetches POIs from OpenStreetMap (runs in the **background** on the API; often **10+ minutes** with polite Overpass pacing and automatic **retry rounds** for failed categories). With **bind-mounted** PostgreSQL, data persists on disk until you remove it or run this rebuild — the UI shows a **banner** with live **`places`** (and **`airports`** / **`notes`**) counts and a wipe warning; the API requires **`confirmWipe: true`** when existing POI rows would be deleted (or the count cannot be read). Optional checkbox to re-seed airport rows from static data (no image crawl). The UI shows a **progress bar**, **percent**, **current step**, and a **per-category list** (pending / running / ok / error with HTTP status). While a job is running, status is polled about every **1.5s**; when idle, about every **4s** (`GET /api/rebuild-inventory/status` via the admin proxy — requires session cookie + matching `ADMIN_RESTART_TOKEN` to the API). **`GET /api/health`** exposes **`mapDataRebuild`** without the admin-only **`dataSnapshot`** row counts. CLI equivalent: `npm run db:rebuild` or `npm run db:rebuild:all` from the project root. For Overpass env vars, retry behaviour, and data sources, see [Database and map data](./DATABASE-AND-MAP-DATA.md) and the [Admin site diagram](./ADMIN-SITE-DIAGRAM.md) (map rebuild flow).
- **Inline Status Board** — collapsible iframe embedding the status board for quick reference without leaving the admin page.

---

## How to run it

### Development

```bash
npm run dev:admin
```

Or directly:

```bash
cd server && node admin.js
```

The admin site starts on `http://localhost:5556` by default.

## Client Login Link (Map Page)

The main map UI includes a fixed-position `Login` link that points to the admin site’s `/login` endpoint on the admin port (default `5556`).

By default, the client builds the URL using the current page’s hostname:
- `http://<current-hostname>:5556/login`

If you run behind a reverse proxy where the “visible” host/port differs, ensure `:<ADMIN_PORT>` routes correctly to the `jamaica-admin` process.

### PM2 (production)

The admin site is included in `ecosystem.config.js` as `jamaica-admin`:

```bash
pm2 start ecosystem.config.js                          # starts all (API + status + admin)
pm2 start ecosystem.config.js --only jamaica-admin      # start admin only
pm2 restart jamaica-admin                               # restart admin
```

---

## Configuration

All configuration is via environment variables in `server/.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_PORT` | `5556` | Port the admin site listens on |
| `ADMIN_HOST` | `0.0.0.0` | Bind address (0.0.0.0 for LAN access) |
| `ADMIN_USER` | `admin` | Login username |
| `ADMIN_PASSWORD` | *(required)* | Login password — the server refuses to start without this |
| `ADMIN_RESTART_TOKEN` | *(empty)* | Must match the API server's `ADMIN_RESTART_TOKEN` for restart commands to work |
| `API_HOST` | `127.0.0.1` | Host the admin process uses to reach the API (`localhost` in env is normalized to `127.0.0.1` for the same IPv4/IPv6 reason as the status board) |
| `API_PORT` | `3001` | Port the admin process uses to reach the API (internal / loopback) |
| `ADMIN_PUBLIC_HOST` | *(from request)* | Optional fixed hostname for Swagger, health, status links, and iframe when `Host` is wrong behind a proxy |
| `ADMIN_PUBLIC_API_PORT` | `API_PORT` | Port in those **browser** URLs when the API is published on a different host port (e.g. Docker `HOST_PORT` → container `3001`) |
| `ADMIN_PUBLIC_STATUS_PORT` | `STATUS_PORT` | Same for the status board URL if its published port differs |
| `STATUS_PORT` | `5555` | Port of the status board (used for links and iframe) |
| `CLIENT_HOST` | `127.0.0.1` | Host used to probe whether the Vite dev server is running |
| `CLIENT_PORT` | `5173` | Port of the Vite dev server (probe + browser URL when Vite is up) |
| `ADMIN_PUBLIC_CLIENT_PORT` | `CLIENT_PORT` | Port in the browser URL for the client when Vite is up and the published port differs |

---

## Authentication

The admin site uses a session-based cookie approach with no additional npm dependencies:

1. On login, the server verifies the username and password against the `ADMIN_USER` and `ADMIN_PASSWORD` environment variables.
2. On success, it sets an `admin_token` cookie containing an HMAC (SHA-256) of the username, signed with a secret derived from `ADMIN_PASSWORD`.
3. Every authenticated route checks the cookie against the expected HMAC value. Invalid or missing cookies redirect to `/login`.
4. The cookie is `HttpOnly`, `SameSite=Strict`, and expires after 24 hours.
5. Changing `ADMIN_PASSWORD` in the env invalidates all active sessions.

### Generating a strong password

```bash
openssl rand -hex 32
```

Copy the output into `server/.env` as `ADMIN_PASSWORD=...`.

---

## Login Brute-Force Protection

The admin site includes dependency-light protection against credential stuffing/brute-force attempts against `POST /login`.

Mechanism (in-memory per `jamaica-admin` process):
- The server tracks failed login attempts per client IP (using `req.ip`).
- Failed attempts are stored in a sliding time window.
- After `ADMIN_LOGIN_MAX_FAILURES` failures within `ADMIN_LOGIN_WINDOW_MS`, the client IP is temporarily locked out for `ADMIN_LOGIN_LOCKOUT_MS`.

Config (all optional; defaults shown):

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_LOGIN_WINDOW_MS` | `900000` | Sliding window duration (default: 15 minutes) |
| `ADMIN_LOGIN_MAX_FAILURES` | `10` | Max failures within the window before lockout |
| `ADMIN_LOGIN_LOCKOUT_MS` | `600000` | Lockout duration (default: 10 minutes) |

Behavior:
- While locked out, `POST /login` redirects back to `/login` with a message ("Too many failed attempts").
- On successful login, failure history for that IP is cleared.

Notes:
- This protection is in-memory and resets if the admin process restarts.
- For multi-node deployments, use a shared store (e.g. Redis) at the infrastructure layer.

---

## Routes

| Route | Auth | Method | Purpose |
|-------|------|--------|---------|
| `/login` | No | GET | Login page |
| `/login` | No | POST | Authenticate and set session cookie |
| `/logout` | No | GET | Clear session cookie and redirect to login |
| `/` | Yes | GET | Admin dashboard |
| `/api/pm2` | Yes | GET | Returns PM2 process list as JSON |
| `/api/client-url` | Yes | GET | Probes the Vite dev server and returns the correct client URL |
| `/api/restart` | Yes | POST | Restart a PM2 process (proxies to API server or self-restarts) |
| `/api/database/backup` | Yes | GET | Download PostgreSQL dump (proxies to `GET /api/admin/database/backup` with `X-Admin-Token`) |
| `/api/database/restore` | Yes | POST | Multipart restore: field `backup` (file), `confirm` = `RESTORE` (proxies to `POST /api/admin/database/restore`) |

### Restart targets

Send a POST to `/api/restart` with a JSON body:

| Target | What it does |
|--------|-------------|
| `api` | Proxies to `POST /api/admin/restart` → `pm2 restart jamaica-api` |
| `status` | Proxies to `POST /api/admin/restart` → `pm2 restart jamaica-status` |
| `admin` | Runs `pm2 restart jamaica-admin` directly (self-restart) |
| `all` | Proxies to `POST /api/admin/restart` → `pm2 restart all` (includes all processes) |

When restarting `api` or `all`, the API server may also rebuild the React client in production if it detects that `client/` sources are newer than `client/dist/`.
This ensures UI changes (title/favicon/etc.) are picked up automatically after the restart.

**Connection reset on API restart:** When the admin proxies a restart command to the API and PM2 kills the API process, the TCP connection drops before a response can be sent (`ECONNRESET` / `EPIPE`). The admin proxy treats these codes as **success** — the connection dying is the expected outcome of a successful restart. The dashboard shows a green "Restarted successfully" toast.

When restarting `admin`, the response may not reach the browser since the process is restarting itself. The dashboard handles this gracefully by showing a message and reloading after 3 seconds.

---

## Implementation details

- **Server file:** `server/admin.js` — single-file Express app following the same pattern as `status-board.js` (inline HTML, no templates, no build step).
- **Dependencies:** Express, **`multer`** (multipart restore proxy), Node's `crypto` for HMAC session tokens, and `http` / `fetch` for proxying restart and database routes to the API.
- **PM2 status** is fetched by running `pm2 jlist --silent` and parsing the JSON output (same approach as the status board).
- **Dark theme** matches the status board's color palette (`#050816` background, `#0b1020` cards, `#1f2937` borders).

---

## Security considerations

- The admin site should only be exposed on trusted networks. For internet-facing deployments, put it behind HTTPS (e.g. Nginx reverse proxy with TLS) and consider external (infrastructure-level) rate limiting even though the admin server includes in-memory lockout for `POST /login`.
- The `HttpOnly` and `SameSite=Strict` cookie flags prevent XSS-based cookie theft and CSRF attacks.
- Restart commands and **database backup/restore** are double-gated: the admin site requires login, and the API server requires the `X-Admin-Token` header (`ADMIN_RESTART_TOKEN`). Restore is destructive; limit oversized uploads via **`ADMIN_DB_RESTORE_MAX_BYTES`** on the API.
- "Restart All" requires a browser confirmation dialog before executing.

---

## Port summary

| Service | Port | Process name |
|---------|------|-------------|
| API server | 3001 | `jamaica-api` |
| Client (Vite) | 5173 | *(dev server, not PM2)* |
| Status board | 5555 | `jamaica-status` |
| Admin site | 5556 | `jamaica-admin` |
