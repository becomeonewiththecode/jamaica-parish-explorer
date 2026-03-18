## Status Board — Live Service Checks

The status board is a lightweight dashboard that reports whether key backend services are reachable and responding as expected. It is intended for local development and basic operational checks.

### What it checks

**Internal services** (checked via the API server):
- **API health**: `GET /api/health` (Express server up, basic info).
- **Island weather**: `GET /api/weather/island` (multi‑provider aggregate across Open‑Meteo, WeatherAPI, OpenWeather).
- **Wave data**: `GET /api/weather/waves` (Open‑Meteo Marine).
- **Flights data**: `GET /api/flights` (scheduled + live flight feed).
- **Vessel data**: `GET /api/vessels` (AISStream snapshot around Jamaica).
- **Cruise schedules**: `GET /api/ports/{port}/cruises` for Montego Bay, Ocho Rios, and Falmouth (scraped and cached cruise calls, shown as a sub-table).

**External APIs** (derived from `/api/health` — no extra API calls):
- **Weather providers**: Open-Meteo, WeatherAPI, OpenWeatherMap — status derived from the main API's cached provider health.
- **Flight providers**: AeroDataBox/RapidAPI, OpenSky, adsb.lol — status derived from the main API's cached provider health (see below).

**Servers**: API server (3001), Client/Vite (5173), and PM2 process status.

Each section title uses a traffic-light colour scheme:
- **Green / ONLINE** — all services healthy.
- **Orange / CHECK** — one service offline.
- **Red / OFFLINE** — two or more services offline.

### How to run it

- **Development**

  1. From the project root, run the initialization helper:

     ```bash
     npm run init
     ```

     This ensures:

     - Backend API is running on `http://localhost:3001` (starts `npm run dev` if needed)
     - Frontend dev server is running on `http://localhost:5173`
     - Status board is running on `http://localhost:5555`

  2. Alternatively, you can start the pieces manually:

     ```bash
     npm run dev        # server + client
     npm run dev:status # status board
     ```

  3. Open the board in a browser:

     - HTML dashboard: `http://localhost:5555/`
     - JSON: `http://localhost:5555/status.json`

- **PM2 (API + status board together)**  
  The API on **3001** and the status board on **5555** are **separate processes**. If only the API is running, `http://<your-LAN-IP>:5555` will refuse connections.

  From the **project root**:

  ```bash
  pm2 start ecosystem.config.js
  pm2 save   # optional: persist after reboot if pm2 startup is configured
  ```

  That starts **jamaica-api** and **jamaica-status**. Check:

  ```bash
  pm2 list
  sudo lsof -i :5555
  ```

  To start only the status board: `pm2 start ecosystem.config.js --only jamaica-status`.

  If **jamaica-status** showed many restarts after an old bug, PM2 may still list it as **errored** while you view the board via `npm run dev:status`. The dashboard treats that row specially (amber + note) and does not fail the whole PM2 summary. To fix PM2: `pm2 delete jamaica-status && pm2 start ecosystem.config.js --only jamaica-status`.

- **Configuration**

  - **Environment variables** (optional):
    - `STATUS_PORT` (default `5555`) — port for the status board.
    - `STATUS_HOST` (default `0.0.0.0`) — bind address; use `0.0.0.0` so the board is reachable on your LAN (e.g. `http://10.0.0.205:5555/`).
    - `API_HOST` (default `localhost`) — where the main API is reachable.
    - `API_PORT` (default `3001`) — port for the main API.
    - `STATUS_REFRESH_MS` (default `600000`) — how often the browser UI refreshes `/status.json` (in ms). Use this to throttle how often the board polls the API.

### Implementation details

- **Server file**: `server/status-board.js`
  - Small Express app listening on `STATUS_PORT`.
  - Uses Node's `http` module to call each backend endpoint with an 8s timeout.
  - Exposes:
    - `GET /status.json` — full JSON snapshot of all checks.
    - `GET /` — minimal HTML UI with auto‑refresh every `STATUS_REFRESH_MS` milliseconds (default 10 minutes).
  - For **weather providers** and **flight providers**, the status board does **not** call external APIs directly. Instead it:
    - Calls the main API's `GET /api/health` once per refresh.
    - Uses the `providers` object (weather) and `flightProviders` object (flights) in that response to render the provider cards, so status reflects the internal service state and cache without consuming API quotas or rate limits.
  - The dashboard UI groups services into cards with 3-column tables (service name with green/red dot indicator, status text, HTTP code).

- **Health endpoint**: `server/index.js`
  - Exposes both weather and flight provider health:

    ```js
    app.get('/api/health', (req, res) => {
      res.json({
        ok: true,
        uptime: process.uptime(),
        env: process.env.NODE_ENV || 'development',
        providers,        // weather provider health from routes/weather.js
        flightProviders,  // flight provider health from routes/flights.js
      });
    });
    ```

  - Flight provider health is tracked in `server/routes/flights.js` via `updateFlightProviderHealth()` and exported via `router.getFlightProviderHealth()`.

### Admin PM2 restart endpoint (DIY remote control)

> ⚠️ **Warning:** This endpoint is powerful and should only be enabled if you understand the risks. It lets the API process ask PM2 to restart processes on the host. Always protect it with a strong shared secret and never expose it to untrusted clients.

- **Endpoint**: `POST /api/admin/restart`
- **Location**: `server/index.js`
- **Usage**:

  - Request headers:

    ```http
    X-Admin-Token: <your-ADMIN_RESTART_TOKEN-value>
    Content-Type: application/json
    ```

  - Optional JSON body:

    ```json
    { "target": "api" }      // pm2 restart jamaica-api
    { "target": "status" }   // pm2 restart jamaica-status
    { "target": "all" }      // pm2 restart all (default)
    ```

- **How authentication works**:

  - On the server, set a **strong, random** token in `server/.env`:

    ```bash
    ADMIN_RESTART_TOKEN=some-long-random-string-here
    ```

  - Each time you call `POST /api/admin/restart`, you must send the **same value** in the `X-Admin-Token` header.
  - The route compares:

    ```js
    const expected = process.env.ADMIN_RESTART_TOKEN;
    const provided = req.headers['x-admin-token'];
    ```

    - If `expected` is missing, or `provided` does not match, it returns `403 Forbidden` and does not run PM2.

- **Generating a strong token** (examples):

  - Using `openssl`:

    ```bash
    openssl rand -hex 32
    # copy the output into server/.env as ADMIN_RESTART_TOKEN=...
    ```

  - Using Node.js:

    ```bash
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    ```

  - Or generate a long random password in a password manager and paste it into `server/.env` as `ADMIN_RESTART_TOKEN=...`.

- **Example: restart API and status board from your machine**:

  ```bash
  # Replace <ADMIN_RESTART_TOKEN> with the exact value from server/.env
  # and <host> with your server hostname or IP.
  curl -X POST http://<host>:3001/api/admin/restart \
    -H "Content-Type: application/json" \
    -H "X-Admin-Token: <ADMIN_RESTART_TOKEN>" \
    -d '{"target":"all"}'

  # Restart only the API process (pm2 restart jamaica-api):
  curl -X POST http://<host>:3001/api/admin/restart \
    -H "Content-Type: application/json" \
    -H "X-Admin-Token: <ADMIN_RESTART_TOKEN>" \
    -d '{"target":"api"}'

  # Restart only the status board process (pm2 restart jamaica-status):
  curl -X POST http://<host>:3001/api/admin/restart \
    -H "Content-Type: application/json" \
    -H "X-Admin-Token: <ADMIN_RESTART_TOKEN>" \
    -d '{"target":"status"}'
  ```

- **NPM script**: `package.json`

  ```json
  "scripts": {
  "dev:status": "cd server && node status-board.js",
  "init": "cd server && node scripts/init-dev.js"
  }
  ```

### Running API + status board under PM2

Once you have PM2 installed globally (`npm install -g pm2`), you can use the provided `ecosystem.config.js` at the project root:

```bash
cd ~/Documents/cursor/project_jamaica

# Start API and status board under PM2
pm2 start ecosystem.config.js

# Optional: see processes
pm2 list

# Optional: persist across reboots
pm2 save
pm2 startup   # follow the printed instructions once
```

With this in place:

- `jamaica-api` runs `server/index.js` on port `3001`.
- `jamaica-status` runs `server/status-board.js` on port `5555`.
- The `/api/admin/restart` endpoint can safely call `pm2 restart jamaica-api`, `pm2 restart jamaica-status`, or `pm2 restart all` without depending on an open terminal session.

> **Containerized / orchestrated environments:** In Docker or Kubernetes you typically do **not** use PM2; instead you run a single Node process per container and let the platform handle restarts and scaling. The status board and `/api/health` work the same either way — PM2 is an optional convenience for standalone VMs or bare-metal servers.

### Flight provider status (no extra API calls)

The status board derives all flight provider health from the main API's `/api/health` endpoint. It does **not** make direct calls to AeroDataBox, OpenSky, or adsb.lol. This avoids:

- Burning RapidAPI quota (AeroDataBox).
- Triggering OpenSky rate limits (which can impose multi-hour backoffs via `X-Rate-Limit-Retry-After-Seconds`).
- Unnecessary duplicate calls to adsb.lol.

The main API's flight polling code (`server/routes/flights.js`) tracks provider health internally via `updateFlightProviderHealth()`. Each successful or failed fetch updates the health state, and the status board reads it via the `flightProviders` field in `/api/health`.

