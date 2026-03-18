# Admin Site

The admin site is an authenticated dashboard for managing the Jamaica Parish Explorer application. It consolidates monitoring, documentation, and remote control into a single interface behind a login wall.

---

## What it provides

- **Quick links** to Swagger API docs, Status Board, Client App, and the Health endpoint (open in new tabs).
- **PM2 process table** showing all managed processes with status, CPU, memory, restarts, and uptime. Auto-refreshes every 30 seconds.
- **Restart controls** — buttons to restart the API server, Status Board, Admin site, or all PM2 processes. Proxies to the API server's `POST /api/admin/restart` endpoint with the `X-Admin-Token` header.
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
| `API_HOST` | `localhost` | Hostname of the main API server |
| `API_PORT` | `3001` | Port of the main API server |
| `STATUS_PORT` | `5555` | Port of the status board (used for links and iframe) |

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
| `/api/restart` | Yes | POST | Restart a PM2 process (proxies to API server or self-restarts) |

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

When restarting `admin`, the response may not reach the browser since the process is restarting itself. The dashboard handles this gracefully by showing a message and reloading after 3 seconds.

---

## Implementation details

- **Server file:** `server/admin.js` — single-file Express app following the same pattern as `status-board.js` (inline HTML, no templates, no build step).
- **No new npm dependencies** — uses Express (already installed), Node's `crypto` for HMAC tokens, and `http` for proxying restart requests.
- **PM2 status** is fetched by running `pm2 jlist --silent` and parsing the JSON output (same approach as the status board).
- **Dark theme** matches the status board's color palette (`#050816` background, `#0b1020` cards, `#1f2937` borders).

---

## Security considerations

- The admin site should only be exposed on trusted networks. For internet-facing deployments, put it behind HTTPS (e.g. Nginx reverse proxy with TLS) and consider external (infrastructure-level) rate limiting even though the admin server includes in-memory lockout for `POST /login`.
- The `HttpOnly` and `SameSite=Strict` cookie flags prevent XSS-based cookie theft and CSRF attacks.
- Restart commands are double-gated: the admin site requires login, and the API server requires the `X-Admin-Token` header.
- "Restart All" requires a browser confirmation dialog before executing.

---

## Port summary

| Service | Port | Process name |
|---------|------|-------------|
| API server | 3001 | `jamaica-api` |
| Client (Vite) | 5173 | *(dev server, not PM2)* |
| Status board | 5555 | `jamaica-status` |
| Admin site | 5556 | `jamaica-admin` |
