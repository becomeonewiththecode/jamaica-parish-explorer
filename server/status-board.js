const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');

// Load server .env so we can see API keys when present
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.STATUS_PORT || 5555;
const API_HOST = process.env.API_HOST || 'localhost';
const API_PORT = process.env.API_PORT || 3001;
const CLIENT_PORT = process.env.CLIENT_PORT || 5173;

// Internal API checks (within this project)
const CHECKS = [
  { id: 'api', label: 'API health', path: '/api/health' },
  { id: 'weather', label: 'Island weather', path: '/api/weather/island' },
  { id: 'waves', label: 'Wave data', path: '/api/weather/waves' },
  { id: 'flights', label: 'Flights data', path: '/api/flights' },
  { id: 'vessels', label: 'Vessel data', path: '/api/vessels' },
  // Combined cruise schedules (all ports)
  { id: 'cruise', label: 'Cruise schedules (all ports)', path: null },
];

const CRUISE_PORT_ENDPOINTS = [
  { id: 'montego-bay', label: 'Montego Bay', path: '/api/ports/montego-bay-cruise-port/cruises' },
  { id: 'ocho-rios', label: 'Ocho Rios', path: '/api/ports/ocho-rios-cruise-port/cruises' },
  { id: 'falmouth', label: 'Falmouth', path: '/api/ports/falmouth-cruise-port/cruises' },
];

// Weather provider endpoints (grouped under one external status)
const WEATHER_PROVIDER_ENDPOINTS = [
  {
    id: 'open-meteo',
    label: 'Open-Meteo weather',
    url: 'https://api.open-meteo.com/v1/forecast?latitude=18.0&longitude=-77.0&current=temperature_2m',
  },
  {
    id: 'open-meteo-marine',
    label: 'Open-Meteo marine',
    url: 'https://marine-api.open-meteo.com/v1/marine?latitude=18.0&longitude=-77.0&current=wave_height',
  },
];

if (process.env.WEATHERAPI_KEY || process.env.WEATHER_API_KEY) {
  WEATHER_PROVIDER_ENDPOINTS.push({
    id: 'weatherapi',
    label: 'WeatherAPI',
    url:
      'https://api.weatherapi.com/v1/current.json?q=18.0,-77.0&key=' +
      encodeURIComponent(process.env.WEATHERAPI_KEY || process.env.WEATHER_API_KEY),
  });
}

// Default refresh interval for status board front-end (ms).
// Can be overridden with STATUS_REFRESH_MS env var.
const STATUS_REFRESH_MS = Number(process.env.STATUS_REFRESH_MS || 600000); // default 10 minutes

// Flight provider endpoints (grouped under one external status)
const FLIGHT_PROVIDER_ENDPOINTS = [
  {
    id: 'opensky',
    label: 'OpenSky (flights)',
    url: 'https://opensky-network.org/api/states/all?lamin=17.0&lamax=19.0&lomin=-79.0&lomax=-75.0',
  },
  {
    id: 'adsb-lol',
    label: 'adsb.lol (flights)',
    url: 'https://api.adsb.lol/v2/lat/18.0/lon/-77.0/dist/50',
  },
];

let openSkyRateLimitedUntil = 0;

// External provider checks (third-party APIs)
const EXTERNAL_CHECKS = [
  // Grouped weather providers (Open-Meteo, WeatherAPI, OpenWeatherMap)
  { id: 'weather-apis', label: 'Weather providers', url: null },
  // Grouped flight/radar providers
  { id: 'flight-apis', label: 'Flight providers', url: null },
];

// Server processes (API, client, status board)
const SERVER_TARGETS = [
  { id: 'api-server', label: 'API server (3001)', host: API_HOST, port: API_PORT, path: '/api/health' },
  { id: 'client-server', label: 'Client (Vite, 5173)', host: 'localhost', port: CLIENT_PORT, path: '/' },
];

function runCheck(path) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = http.get(
      { host: API_HOST, port: API_PORT, path, timeout: 8000 },
      (res) => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        res.resume(); // discard body
        resolve({ ok, code: res.statusCode, ms: Date.now() - started });
      }
    );
    req.on('error', (err) => {
      resolve({ ok: false, error: err.message, ms: Date.now() - started });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout', ms: Date.now() - started });
    });
  });
}

function runServerCheck(target) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = http.get(
      { host: target.host, port: target.port, path: target.path, timeout: 4000 },
      (res) => {
        const ok = res.statusCode >= 200 && res.statusCode < 500;
        res.resume();
        resolve({ ok, code: res.statusCode, ms: Date.now() - started });
      }
    );
    req.on('error', () => resolve({ ok: false }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false });
    });
  });
}

function runExternalCheck(urlString) {
  return new Promise((resolve) => {
    const started = Date.now();
    let url;
    try {
      url = new URL(urlString);
    } catch (e) {
      return resolve({ ok: false, error: 'invalid url', ms: 0 });
    }
    // Simple 429 backoff for OpenSky to avoid constant red when rate limited
    if (url.hostname.includes('opensky-network.org') && Date.now() < openSkyRateLimitedUntil) {
      return resolve({ ok: false, code: 429, error: 'backoff', ms: 0 });
    }

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        timeout: 8000,
      },
      (res) => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        res.resume();
        if (url.hostname.includes('opensky-network.org') && res.statusCode === 429) {
          // Back off OpenSky checks for 10 minutes
          openSkyRateLimitedUntil = Date.now() + 10 * 60 * 1000;
        }
        resolve({ ok, code: res.statusCode, ms: Date.now() - started });
      }
    );
    req.on('error', (err) => {
      resolve({ ok: false, error: err.message, ms: Date.now() - started });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout', ms: Date.now() - started });
    });
  });
}

function fetchApiHealth() {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = http.get(
      { host: API_HOST, port: API_PORT, path: '/api/health', timeout: 8000 },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          let json;
          try {
            json = JSON.parse(body);
          } catch (e) {
            // ignore parse errors; json stays undefined
          }
          const ok = res.statusCode >= 200 && res.statusCode < 300;
          resolve({ ok, code: res.statusCode, ms: Date.now() - started, body: json });
        });
      }
    );
    req.on('error', (err) => {
      resolve({ ok: false, error: err.message, ms: Date.now() - started });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout', ms: Date.now() - started });
    });
  });
}

app.get('/status.json', async (req, res) => {
  const results = {};
  const external = {};
  const servers = {};
  const apiHealth = await fetchApiHealth();
  await Promise.all(
    CHECKS.map(async (c) => {
      if (c.id === 'cruise') {
        // Aggregate cruise status across all configured ports
        const perPort = await Promise.all(
          CRUISE_PORT_ENDPOINTS.map(async (p) => {
            const r = await runCheck(p.path);
            return { port: p.id, label: p.label, ...r };
          })
        );
        const allOk = perPort.every(p => p.ok);
        const firstBad = perPort.find(p => !p.ok);
        results[c.id] = {
          ok: allOk,
          code: allOk ? 200 : (firstBad && firstBad.code) || 500,
          ms: perPort.reduce((max, p) => Math.max(max, p.ms || 0), 0),
          error: allOk ? undefined : perPort.map(p => `${p.label}:${p.ok ? 'OK' : (p.code || p.error || 'FAIL')}`).join(', '),
          ports: perPort,
        };
      } else {
        results[c.id] = await runCheck(c.path);
      }
    })
  );

  // Derive weather provider status from the API health endpoint, so we don't
  // hit OpenWeather (or other providers) directly from the status board.
  if (apiHealth && apiHealth.body && apiHealth.body.providers) {
    const prov = apiHealth.body.providers;
    const providerEntries = Object.entries(prov).map(([id, h]) => {
      const label =
        id === 'openweather'
          ? 'OpenWeatherMap'
          : id === 'weatherapi'
          ? 'WeatherAPI'
          : 'Open-Meteo';
      const ok = !!h.lastOk;
      return {
        id,
        label,
        ok,
        code: ok ? 200 : 500,
        error: ok ? undefined : h.lastError || 'unhealthy',
      };
    });
    if (providerEntries.length) {
      const allOk = providerEntries.every((p) => p.ok);
      external['weather-apis'] = {
        ok: allOk,
        code: allOk ? 200 : 500,
        ms: apiHealth.ms,
        providers: providerEntries,
      };
    }
  }

  await Promise.all(
    EXTERNAL_CHECKS.map(async (c) => {
      if (c.id === 'weather-apis') {
        // Weather provider status is derived from the main API's /api/health.
        // Nothing to do here; external['weather-apis'] is populated above.
        return;
      } else if (c.id === 'flight-apis') {
        // Group flight providers under one status entry
        const perProvider = await Promise.all(
          FLIGHT_PROVIDER_ENDPOINTS.map(async (p) => {
            const r = await runExternalCheck(p.url);
            return { id: p.id, label: p.label, ...r };
          })
        );
        const allOk = perProvider.every(p => p.ok);
        const firstBad = perProvider.find(p => !p.ok);
        external[c.id] = {
          ok: allOk,
          code: allOk ? 200 : (firstBad && firstBad.code) || 500,
          ms: perProvider.reduce((max, p) => Math.max(max, p.ms || 0), 0),
          error: allOk ? undefined : perProvider.map(p => `${p.label}:${p.ok ? 'OK' : (p.code || p.error || 'FAIL')}`).join(', '),
          providers: perProvider,
        };
      } else {
        external[c.id] = await runExternalCheck(c.url);
      }
    })
  );
  await Promise.all(
    SERVER_TARGETS.map(async (s) => {
      servers[s.id] = await runServerCheck(s);
    })
  );
  res.json({
    timestamp: new Date().toISOString(),
    host: API_HOST,
    port: API_PORT,
    checks: results,
    external,
    servers,
  });
});

app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Jamaica Explorer – Status Board</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#050816; color:#f9fafb; margin:0; padding:2rem; }
    h1 { margin-top:0; font-size:1.8rem; }
    .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:1rem; margin-top:1.5rem; }
    .card { padding:1rem 1.1rem; border-radius:0.75rem; background:#0b1020; border:1px solid #1f2937; box-shadow:0 10px 30px rgba(0,0,0,0.4); }
    .name { font-weight:600; margin-bottom:0.35rem; }
    .status { font-weight:600; font-size:0.9rem; margin-bottom:0.15rem; }
    .ok { color:#4ade80; }
    .fail { color:#f97373; }
    .meta { font-size:0.8rem; color:#9ca3af; }
    .pill-btn { display:inline-flex; align-items:center; justify-content:center; padding:0.15rem 0.6rem; border-radius:999px; font-size:0.75rem; font-weight:600; margin-right:0.25rem; margin-bottom:0.25rem; }
    .pill-btn.ok { background:#064e3b; color:#6ee7b7; }
    .pill-btn.fail { background:#7f1d1d; color:#fecaca; }
    .status-table { width:100%; border-collapse:collapse; margin-top:0.35rem; }
    .status-table th, .status-table td { padding:0.1rem 0.2rem; font-size:0.78rem; text-align:left; vertical-align:middle; }
    .status-table th { font-weight:600; color:#d1d5db; }
    .status-table th.code, .status-table td.code { width:4rem; text-align:right; }
    header { display:flex; justify-content:space-between; align-items:center; gap:1rem; flex-wrap:wrap; }
    .pill { font-size:0.75rem; padding:0.15rem 0.5rem; border-radius:999px; background:#111827; color:#9ca3af; }
    .updated { font-size:0.8rem; color:#9ca3af; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Jamaica Explorer – Status Board</h1>
      <div class="updated" id="updated"></div>
    </div>
    <div class="pill">backend: <span id="api-host"></span></div>
  </header>
  <p class="updated">This page pings the main API for flights, weather, waves, vessels, and cruise data every 15 seconds and shows whether each service is ONLINE or OFFLINE. It also checks external provider APIs and server processes.</p>
  <h2 style="font-size:1rem; margin-top:1.5rem;">Servers</h2>
  <div class="grid" id="grid-servers"></div>
  <h2 style="font-size:1rem; margin-top:1.5rem;">Internal services</h2>
  <div class="grid" id="grid"></div>
  <h2 style="font-size:1rem; margin-top:2rem;">External APIs</h2>
  <div class="grid" id="grid-external"></div>
  <script>
    const CHECKS = ${JSON.stringify(CHECKS.map(c => ({ id: c.id, label: c.label })))};
    const EXTERNAL = ${JSON.stringify(EXTERNAL_CHECKS.map(c => ({ id: c.id, label: c.label })))};
    const SERVERS = ${JSON.stringify(SERVER_TARGETS.map(s => ({ id: s.id, label: s.label })))};
    async function refresh() {
      try {
        const res = await fetch('/status.json');
        const data = await res.json();
        document.getElementById('updated').textContent =
          'Last updated ' + new Date(data.timestamp).toLocaleString();
        document.getElementById('api-host').textContent = data.host + ':' + data.port;
        const gridServers = document.getElementById('grid-servers');
        const grid = document.getElementById('grid');
        gridServers.innerHTML = '';
        grid.innerHTML = '';
        const gridExternal = document.getElementById('grid-external');
        gridExternal.innerHTML = '';

        // Servers card
        (function renderServers() {
          const card = document.createElement('div');
          card.className = 'card';
          let rowsHtml = '';
          if (SERVERS.length) {
            rowsHtml += '<table class="status-table"><thead><tr><th>Server</th><th class="code">Status</th></tr></thead><tbody>';
            for (const s of SERVERS) {
              const r = data.servers && data.servers[s.id];
              const ok = r && r.ok;
              const codeText = (r && r.code !== undefined && r.code !== null) ? r.code : (ok ? 'OK' : 'OFF');
              rowsHtml +=
                '<tr>' +
                  '<td><span class="pill-btn ' + (ok ? 'ok' : 'fail') + '">' + s.label + '</span></td>' +
                  '<td class="code">' + codeText + '</td>' +
                '</tr>';
            }
            rowsHtml += '</tbody></table>';
          }
          card.innerHTML =
            '<div class="name">Servers</div>' +
            '<div class="status ' + ((Object.values(data.servers || {}).every(s => s && s.ok)) ? 'ok' : 'fail') + '">' +
              ((Object.values(data.servers || {}).every(s => s && s.ok)) ? 'ONLINE' : 'CHECK') +
            '</div>' +
            '<div class="meta">' +
              (rowsHtml || 'No server info') +
            '</div>' +
            '<div class="meta" style="margin-top:0.5rem; font-size:0.75rem;">' +
              'Restart commands: <code>npm run init</code>, <code>npm run dev:server</code>, <code>npm run dev:client</code>, <code>npm run dev:status</code>' +
            '</div>';
          gridServers.appendChild(card);
        })();
        for (const c of CHECKS) {
          const r = data.checks[c.id];
          const ok = r && r.ok;
          const card = document.createElement('div');
          card.className = 'card';

          if (c.id === 'cruise') {
            // Special rendering: one card with per-port table like providers
            const ports = (r && r.ports) || [];
            let rowsHtml = '';
            if (ports.length) {
              rowsHtml += '<table class="status-table"><thead><tr><th>Cruise schedules</th><th class="code">Status</th></tr></thead><tbody>';
              for (const p of ports) {
                const pok = p && p.ok;
                const codeText = (p.code !== undefined && p.code !== null) ? p.code : (pok ? 'OK' : (p.error || 'FAIL'));
                rowsHtml +=
                  '<tr>' +
                    '<td><span class="pill-btn ' + (pok ? 'ok' : 'fail') + '">' + p.label + '</span></td>' +
                    '<td class="code">' + codeText + '</td>' +
                  '</tr>';
              }
              rowsHtml += '</tbody></table>';
            }
            card.innerHTML =
              '<div class="name">' + c.label + '</div>' +
              '<div class="status ' + (ok ? 'ok' : 'fail') + '">' +
                (ok ? 'ONLINE' : 'OFFLINE') +
              '</div>' +
              '<div class="meta">' +
                (ports.length ? rowsHtml : (r ? ('code: ' + (r.code || '-') + ' · ' + (r.ms || 0) + ' ms') : 'no data')) +
              '</div>';
          } else {
            card.innerHTML =
              '<div class="name">' + c.label + '</div>' +
              '<div class="status ' + (ok ? 'ok' : 'fail') + '">' +
                (ok ? 'ONLINE' : 'OFFLINE') +
              '</div>' +
              '<div class="meta">' +
                (r ? ('code: ' + (r.code || '-') + ' · ' + (r.ms || 0) + ' ms' + (r.error ? ' · ' + r.error : '')) : 'no data') +
              '</div>';
          }

          grid.appendChild(card);
        }

        for (const c of EXTERNAL) {
          const r = data.external && data.external[c.id];
          const ok = r && r.ok;
          const card = document.createElement('div');
          card.className = 'card';

          if (c.id === 'weather-apis') {
            const providers = (r && r.providers) || [];
            let rowsHtml = '';
            if (providers.length) {
              rowsHtml += '<table class="status-table"><thead><tr><th>API service</th><th class="code">Status</th></tr></thead><tbody>';
              for (const p of providers) {
                const pok = p && p.ok;
                const codeText = (p.code !== undefined && p.code !== null) ? p.code : (pok ? 'OK' : (p.error || 'FAIL'));
                rowsHtml +=
                  '<tr>' +
                    '<td><span class="pill-btn ' + (pok ? 'ok' : 'fail') + '">' + p.label + '</span></td>' +
                    '<td class="code">' + codeText + '</td>' +
                  '</tr>';
              }
              rowsHtml += '</tbody></table>';
            }
            card.innerHTML =
              '<div class="name">' + c.label + '</div>' +
              '<div class="status ' + (ok ? 'ok' : 'fail') + '">' +
                (ok ? 'ONLINE' : 'OFFLINE') +
              '</div>' +
              '<div class="meta">' +
                (providers.length ? rowsHtml : (r ? ('code: ' + (r.code || '-') + ' · ' + (r.ms || 0) + ' ms') : 'no data')) +
              '</div>';
          } else if (c.id === 'flight-apis') {
            const providers = (r && r.providers) || [];
            let rowsHtml = '';
            if (providers.length) {
              rowsHtml += '<table class="status-table"><thead><tr><th>API service</th><th class="code">Status</th></tr></thead><tbody>';
              for (const p of providers) {
                const pok = p && p.ok;
                const codeText = (p.code !== undefined && p.code !== null) ? p.code : (pok ? 'OK' : (p.error || 'FAIL'));
                rowsHtml +=
                  '<tr>' +
                    '<td><span class="pill-btn ' + (pok ? 'ok' : 'fail') + '">' + p.label + '</span></td>' +
                    '<td class="code">' + codeText + '</td>' +
                  '</tr>';
              }
              rowsHtml += '</tbody></table>';
            }
            card.innerHTML =
              '<div class="name">' + c.label + '</div>' +
              '<div class="status ' + (ok ? 'ok' : 'fail') + '">' +
                (ok ? 'ONLINE' : 'OFFLINE') +
              '</div>' +
              '<div class="meta">' +
                (providers.length ? rowsHtml : (r ? ('code: ' + (r.code || '-') + ' · ' + (r.ms || 0) + ' ms') : 'no data')) +
              '</div>';
          } else {
            card.innerHTML =
              '<div class="name">' + c.label + '</div>' +
              '<div class="status ' + (ok ? 'ok' : 'fail') + '">' +
                (ok ? 'ONLINE' : 'OFFLINE') +
              '</div>' +
              '<div class="meta">' +
                (r ? ('code: ' + (r.code || '-') + ' · ' + (r.ms || 0) + ' ms' + (r.error ? ' · ' + r.error : '')) : 'no data') +
              '</div>';
          }

          gridExternal.appendChild(card);
        }
      } catch (e) {
        document.getElementById('updated').textContent = 'Status fetch failed: ' + e.message;
      }
    }
    refresh();
    // Front-end refresh interval (mirrors STATUS_REFRESH_MS on the server)
    setInterval(refresh, ${STATUS_REFRESH_MS});
  </script>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log('Status board running on http://localhost:' + PORT);
});

