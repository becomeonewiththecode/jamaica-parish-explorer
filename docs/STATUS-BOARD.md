## Status Board — Live Service Checks

The status board is a lightweight dashboard that reports whether key backend services are reachable and responding as expected. It is intended for local development and basic operational checks.

### What it checks

- **API health**: `GET /api/health` (Express server up, basic info).
- **Island weather**: `GET /api/weather/island` (multi‑provider aggregate across Open‑Meteo, WeatherAPI, OpenWeather).
- **Wave data**: `GET /api/weather/waves` (Open‑Meteo Marine).
- **Flights data**: `GET /api/flights` (scheduled + live flight feed).
- **Vessel data**: `GET /api/vessels` (AISStream snapshot around Jamaica).
- **Cruise schedules (Montego Bay)**: `GET /api/ports/montego-bay-cruise-port/cruises` (scraped and cached cruise calls).

Each check is displayed as **ONLINE** (green) or **OFFLINE** (red), with HTTP status code, response time, and any error message.

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

- **Configuration**

  - **Environment variables** (optional):
    - `STATUS_PORT` (default `5555`) — port for the status board.
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
  - For **weather providers**, the status board no longer calls OpenWeather (or other weather APIs) directly. Instead it:
    - Calls the main API's `GET /api/health` once per refresh.
    - Uses the `providers` object in that response to render the "Weather providers" card (Open‑Meteo, WeatherAPI, OpenWeather) so provider health reflects the internal service state and cache.

- **Health endpoint**: `server/index.js`
  - Adds:

    ```js
    app.get('/api/health', (req, res) => {
      res.json({
        ok: true,
        uptime: process.uptime(),
        env: process.env.NODE_ENV || 'development',
        providers, // optional: weather provider health snapshot from routes/weather.js
      });
    });
    ```

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

- **NPM script**: `package.json`

  ```json
  "scripts": {
  "dev:status": "cd server && node status-board.js",
  "init": "cd server && node scripts/init-dev.js"
  }
  ```

