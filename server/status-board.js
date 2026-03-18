const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const { exec } = require('child_process');

// Load server .env so we can see API keys when present
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.STATUS_PORT || 5555;
/** Bind all interfaces so LAN (e.g. 10.0.0.x:5555) works, not only localhost */
const HOST = process.env.STATUS_HOST || '0.0.0.0';
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

// All flight provider statuses are derived from /api/health to avoid extra API calls.

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

function fetchPm2Status() {
  return new Promise((resolve) => {
    const started = Date.now();
    exec('pm2 jlist --silent', { maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        return resolve({
          ok: false,
          code: 500,
          error: stderr && stderr.trim() ? stderr.trim() : err.message,
          ms: Date.now() - started,
          processes: [],
        });
      }
      try {
        const raw = JSON.parse(stdout || '[]');
        const processes = Array.isArray(raw)
          ? raw.map((p) => {
              const env = p.pm2_env || {};
              const monit = p.monit || {};
              const memBytes = typeof monit.memory === 'number' ? monit.memory : null;
              return {
                name: p.name || env.name || 'unknown',
                status: env.status || 'unknown',
                restarts: typeof env.restart_time === 'number' ? env.restart_time : null,
                cpu: typeof monit.cpu === 'number' ? monit.cpu + '%' : null,
                memory: memBytes !== null ? (memBytes / (1024 * 1024)).toFixed(1) + ' MB' : null,
              };
            })
          : [];
        // jamaica-status often shows "errored" while the board is still served by
        // npm run dev:status or a fresh node process; don't fail the whole PM2 strip.
        const allOnline =
          processes.length > 0 &&
          processes.every((p) =>
            p.name === 'jamaica-status' ? true : p.status === 'online'
          );
        resolve({
          ok: allOnline,
          code: processes.length ? (allOnline ? 200 : 500) : 204,
          ms: Date.now() - started,
          processes,
        });
      } catch (e) {
        resolve({
          ok: false,
          code: 500,
          error: 'Failed to parse pm2 jlist output',
          ms: Date.now() - started,
          processes: [],
        });
      }
    });
  });
}

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
        const code = res.statusCode;
        const ok = code >= 200 && code < 500;
        res.resume();
        resolve({ ok, code, ms: Date.now() - started });
      }
    );
    req.on('error', (err) =>
      resolve({
        ok: false,
        error: (err && err.code) || err.message || 'error',
        ms: Date.now() - started,
      })
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({
        ok: false,
        error: 'timeout',
        ms: Date.now() - started,
      });
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
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        timeout: 8000,
      },
      (res) => {
        const base = { ms: Date.now() - started, code: res.statusCode };
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        res.resume();
        resolve({ ok, ...base });
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
  const pm2 = await fetchPm2Status();
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
        // All flight provider statuses derived from /api/health (no extra API calls)
        if (apiHealth && apiHealth.body && apiHealth.body.flightProviders) {
          const fp = apiHealth.body.flightProviders;
          const FLIGHT_PROVIDER_LABELS = {
            aerodatabox: 'AeroDataBox / RapidAPI',
            opensky: 'OpenSky (flights)',
            'adsb-lol': 'adsb.lol (flights)',
          };
          const providerEntries = Object.entries(fp).map(([id, h]) => {
            const ok = !!h.lastOk;
            return {
              id,
              label: FLIGHT_PROVIDER_LABELS[id] || id,
              ok,
              code: ok ? 200 : 500,
              error: ok ? undefined : h.lastError || 'unhealthy',
            };
          });
          const anyOk = providerEntries.some(p => p.ok);
          external[c.id] = {
            ok: anyOk,
            code: anyOk ? 200 : 500,
            ms: apiHealth.ms,
            providers: providerEntries,
          };
        }
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

  const underPm2 =
    process.env.pm_id !== undefined &&
    /status-board\.js$/.test(String(process.argv[1] || '').replace(/\\/g, '/'));
  if (pm2.processes && Array.isArray(pm2.processes)) {
    pm2.processes = pm2.processes.map((proc) => {
      if (proc.name !== 'jamaica-status' || proc.status === 'online') return proc;
      return {
        ...proc,
        pm2RowNote:
          underPm2
            ? 'PM2 may still show old state; this page is served by PID ' + process.pid
            : 'Dashboard is up (this request). PM2 slot is not online — align with: pm2 restart jamaica-status or pm2 delete jamaica-status && pm2 start ecosystem.config.js --only jamaica-status',
        pm2RowOkish: true,
      };
    });
  }

  // Build a clean PM2 object for JSON output (strip internal rendering hints)
  const pm2Json = {
    ok: pm2.ok,
    ms: pm2.ms,
    processes: (pm2.processes || []).map(({ pm2RowNote, pm2RowOkish, ...rest }) => rest),
  };
  if (pm2.error) pm2Json.error = pm2.error;

  res.json({
    timestamp: new Date().toISOString(),
    host: API_HOST,
    port: API_PORT,
    servers,
    checks: results,
    external,
    pm2: pm2Json,
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
    .warn { color:#fbbf24; }
    .fail { color:#f97373; }
    .meta { font-size:0.8rem; color:#9ca3af; }
    .pill-btn { display:inline-flex; align-items:center; justify-content:center; padding:0.15rem 0.6rem; border-radius:999px; font-size:0.75rem; font-weight:600; margin-right:0.25rem; margin-bottom:0.25rem; }
    .pill-btn.ok { background:#064e3b; color:#6ee7b7; }
    .pill-btn.fail { background:#7f1d1d; color:#fecaca; }
    .pill-btn.warn { background:#422006; color:#fcd34d; }
    .status-table { width:100%; border-collapse:collapse; margin-top:0.35rem; }
    .status-table th, .status-table td { padding:0.1rem 0.2rem; font-size:0.78rem; text-align:left; vertical-align:middle; }
    .status-table th { font-weight:600; color:#d1d5db; }
    .status-table th.code, .status-table td.code { width:4rem; text-align:right; }
    .status-table.servers-3col { table-layout:fixed; }
    .status-table.servers-3col th, .status-table.servers-3col td { padding:0.3rem 0.4rem; }
    .status-table.servers-3col th.col-app, .status-table.servers-3col td.col-app { width:44%; }
    .status-table.servers-3col th.col-status, .status-table.servers-3col td.col-status { width:36%; color:#d1d5db; }
    .status-table.servers-3col th.col-code, .status-table.servers-3col td.col-code { width:20%; text-align:right; font-variant-numeric:tabular-nums; color:#e5e7eb; }
    .status-table.servers-3col td.col-app { font-weight:600; }
    .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:0.4rem; vertical-align:middle; }
    .dot.ok { background:#4ade80; box-shadow:0 0 4px #4ade80; }
    .dot.fail { background:#f97373; box-shadow:0 0 4px #f97373; }
    .dot.warn { background:#fcd34d; box-shadow:0 0 4px #fcd34d; }
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
  <h2 style="font-size:1rem; margin-top:1.5rem;">Servers</h2>
  <div id="grid-servers" style="margin-top:1rem;"></div>
  <h2 style="font-size:1rem; margin-top:1.5rem;">Internal services</h2>
  <div id="grid" style="margin-top:1rem;"></div>
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

        // Servers card — 3 columns: application (pill) | status | code
        function esc(t) { return String(t == null ? '' : t).replace(/</g, '&lt;'); }
        // Determine section status: 0 failures = green/ONLINE, 1 = orange/CHECK, 2+ = red/OFFLINE
        function sectionStatus(failCount) {
          if (failCount === 0) return { cls: 'ok', label: 'ONLINE' };
          if (failCount === 1) return { cls: 'warn', label: 'CHECK' };
          return { cls: 'fail', label: 'OFFLINE' };
        }
        (function renderServers() {
          function serverAppRow(r) {
            if (!r) return { pill: 'fail', status: 'unknown', code: '—' };
            var c = r.code;
            if (r.ok && typeof c === 'number' && c >= 200 && c < 300)
              return { pill: 'ok', status: 'online', code: String(c) };
            if (r.ok && typeof c === 'number' && c >= 300 && c < 400)
              return { pill: 'warn', status: 'redirect', code: String(c) };
            if (r.ok && typeof c === 'number' && c >= 400 && c < 500) {
              if (c === 401) return { pill: 'fail', status: 'unauthorized', code: '401' };
              if (c === 403) return { pill: 'fail', status: 'forbidden', code: '403' };
              if (c === 429) return { pill: 'warn', status: 'rate limited', code: '429' };
              if (c === 404) return { pill: 'fail', status: 'not found', code: '404' };
              return { pill: 'fail', status: 'client error', code: String(c) };
            }
            if (r.ok && typeof c === 'number' && c >= 500)
              return { pill: 'fail', status: 'server error', code: String(c) };
            if (typeof c === 'number' && !r.ok) {
              if (c === 401) return { pill: 'fail', status: 'unauthorized', code: '401' };
              if (c === 403) return { pill: 'fail', status: 'forbidden', code: '403' };
              if (c === 429) return { pill: 'warn', status: 'rate limited', code: '429' };
              if (c >= 400 && c < 500) return { pill: 'fail', status: 'client error', code: String(c) };
              if (c >= 500) return { pill: 'fail', status: 'server error', code: String(c) };
            }
            if (c == null) {
              if (r.error === 'timeout') return { pill: 'fail', status: 'timeout', code: '—' };
              return { pill: 'fail', status: 'OFF', code: '—' };
            }
            return { pill: 'fail', status: 'offline', code: '—' };
          }
          function pm2AppRow(p, warnRow) {
            var online = p.status === 'online';
            if (online) return { pill: 'ok', status: 'online', code: 'OK' };
            if (warnRow)
              return { pill: 'warn', status: 'errored (PM2)', code: '—' };
            var st = (p.status || '').toLowerCase();
            if (st === 'stopped') return { pill: 'fail', status: 'stopped', code: '—' };
            if (st === 'errored') return { pill: 'fail', status: 'errored', code: 'ERR' };
            return { pill: 'fail', status: esc(p.status || 'unknown'), code: '—' };
          }
          const card = document.createElement('div');
          card.className = 'card';
          let rowsHtml = '';
          if (SERVERS.length) {
            rowsHtml +=
              '<table class="status-table servers-3col"><thead><tr>' +
              '<th class="col-app">Application</th><th class="col-status">Status</th><th class="col-code">Code</th>' +
              '</tr></thead><tbody>';
            for (const s of SERVERS) {
              const r = data.servers && data.servers[s.id];
              const row = serverAppRow(r);
              rowsHtml +=
                '<tr>' +
                  '<td class="col-app"><span class="dot ' + row.pill + '"></span>' + esc(s.label) + '</td>' +
                  '<td class="col-status">' + esc(row.status) + '</td>' +
                  '<td class="col-code">' + esc(row.code) + '</td>' +
                '</tr>';
            }
            rowsHtml += '</tbody></table>';
          }

          const pm2 = data.pm2;
          const pm2Procs = pm2 && Array.isArray(pm2.processes) ? pm2.processes : [];
          const pm2Healthy =
            !pm2 ||
            pm2.ok ||
            (pm2Procs.length > 0 &&
              pm2Procs.every((p) => p.name === 'jamaica-status' || p.status === 'online'));
          let pm2Html = '';
          if (pm2Procs.length) {
            pm2Html += '<div style="margin-top:0.75rem; font-size:0.8rem; font-weight:600;">PM2 processes</div>';
            pm2Html +=
              '<table class="status-table servers-3col"><thead><tr>' +
              '<th class="col-app">Application</th><th class="col-status">Status</th><th class="col-code">Code</th>' +
              '</tr></thead><tbody>';
            for (const p of pm2Procs) {
              const online = p.status === 'online';
              const isStatusApp = p.name === 'jamaica-status';
              const warnRow = !online && isStatusApp;
              const row = pm2AppRow(p, warnRow);
              let note = p.pm2RowNote
                ? String(p.pm2RowNote)
                : warnRow
                  ? 'You are viewing this page; PM2 may show a stale slot. pm2 delete jamaica-status && pm2 start ecosystem.config.js --only jamaica-status'
                  : '';
              let statusCell = esc(row.status);
              if (note) {
                statusCell +=
                  '<div style="font-size:0.65rem;color:#9ca3af;margin-top:0.2rem;line-height:1.2;">' +
                  esc(note) +
                  '</div>';
              }
              pm2Html +=
                '<tr>' +
                  '<td class="col-app"><span class="dot ' + row.pill + '"></span>' + esc(p.name || 'unknown') + '</td>' +
                  '<td class="col-status">' + statusCell + '</td>' +
                  '<td class="col-code">' + esc(row.code) + '</td>' +
                '</tr>';
            }
            pm2Html += '</tbody></table>';
          }
          var serverFails = Object.values(data.servers || {}).filter(s => !s || !s.ok).length;
          if (!pm2Healthy) serverFails++;
          var srvSt = sectionStatus(serverFails);
          card.innerHTML =
            '<div class="name">Servers</div>' +
            '<div class="status ' + srvSt.cls + '">' + srvSt.label + '</div>' +
            '<div class="meta">' +
              (rowsHtml || 'No server info') +
              (pm2Html ? pm2Html : '') +
            '</div>';
          gridServers.appendChild(card);
        })();
        // Combined internal services card
        (function renderInternalServices() {
          const card = document.createElement('div');
          card.className = 'card';
          var checkFails = CHECKS.filter(function(c) { const r = data.checks[c.id]; return !r || !r.ok; }).length;
          let rowsHtml = '<table class="status-table servers-3col"><thead><tr>' +
            '<th class="col-app">Service</th><th class="col-status">Status</th><th class="col-code">Code</th>' +
            '</tr></thead><tbody>';
          for (const c of CHECKS) {
            if (c.id === 'cruise') continue; // rendered separately below
            const r = data.checks[c.id];
            const rok = r && r.ok;
            const statusText = !r ? 'no data' : rok ? 'online' : (r.error || 'offline');
            const codeText = !r ? '—' : (r.code !== undefined && r.code !== null) ? r.code : (rok ? 'OK' : '—');
            rowsHtml +=
              '<tr>' +
                '<td class="col-app"><span class="dot ' + (rok ? 'ok' : 'fail') + '"></span>' + esc(c.label) + '</td>' +
                '<td class="col-status">' + esc(statusText) + '</td>' +
                '<td class="col-code">' + esc(String(codeText)) + '</td>' +
              '</tr>';
          }
          rowsHtml += '</tbody></table>';
          // Cruise ports sub-table
          const cruiseCheck = CHECKS.find(function(c) { return c.id === 'cruise'; });
          let cruiseHtml = '';
          if (cruiseCheck) {
            const cr = data.checks['cruise'];
            const ports = (cr && cr.ports) || [];
            if (ports.length) {
              cruiseHtml += '<div style="margin-top:0.75rem; font-size:0.8rem; font-weight:600;">Cruise schedules</div>';
              cruiseHtml += '<table class="status-table servers-3col"><thead><tr>' +
                '<th class="col-app">Port</th><th class="col-status">Status</th><th class="col-code">Code</th>' +
                '</tr></thead><tbody>';
              for (const p of ports) {
                const pok = p && p.ok;
                const statusText = pok ? 'online' : (p.error || 'offline');
                const codeText = (p.code !== undefined && p.code !== null) ? p.code : (pok ? 'OK' : '—');
                cruiseHtml +=
                  '<tr>' +
                    '<td class="col-app"><span class="dot ' + (pok ? 'ok' : 'fail') + '"></span>' + esc(p.label) + '</td>' +
                    '<td class="col-status">' + esc(statusText) + '</td>' +
                    '<td class="col-code">' + esc(String(codeText)) + '</td>' +
                  '</tr>';
              }
              cruiseHtml += '</tbody></table>';
            }
          }
          var intSt = sectionStatus(checkFails);
          card.innerHTML =
            '<div class="name">Internal Services</div>' +
            '<div class="status ' + intSt.cls + '">' + intSt.label + '</div>' +
            '<div class="meta">' + rowsHtml + cruiseHtml + '</div>';
          grid.appendChild(card);
        })();

        for (const c of EXTERNAL) {
          const r = data.external && data.external[c.id];
          const ok = r && r.ok;
          const card = document.createElement('div');
          card.className = 'card';

          if (c.id === 'weather-apis') {
            const providers = (r && r.providers) || [];
            let rowsHtml = '';
            if (providers.length) {
              rowsHtml += '<table class="status-table servers-3col"><thead><tr><th class="col-app">API service</th><th class="col-status">Status</th><th class="col-code">Code</th></tr></thead><tbody>';
              for (const p of providers) {
                const pok = p && p.ok;
                const statusText = pok ? 'online' : (p.error || 'offline');
                const codeText = (p.code !== undefined && p.code !== null) ? p.code : (pok ? 'OK' : '—');
                rowsHtml +=
                  '<tr>' +
                    '<td class="col-app"><span class="dot ' + (pok ? 'ok' : 'fail') + '"></span>' + p.label + '</td>' +
                    '<td class="col-status">' + statusText + '</td>' +
                    '<td class="col-code">' + codeText + '</td>' +
                  '</tr>';
              }
              rowsHtml += '</tbody></table>';
            }
            var wFails = providers.filter(function(p) { return !p || !p.ok; }).length;
            var wSt = sectionStatus(wFails);
            card.innerHTML =
              '<div class="name">' + c.label + '</div>' +
              '<div class="status ' + wSt.cls + '">' + wSt.label + '</div>' +
              '<div class="meta">' +
                (providers.length ? rowsHtml : (r ? ('code: ' + (r.code || '-') + ' · ' + (r.ms || 0) + ' ms') : 'no data')) +
              '</div>';
          } else if (c.id === 'flight-apis') {
            const providers = (r && r.providers) || [];
            let rowsHtml = '';
            if (providers.length) {
              rowsHtml += '<table class="status-table servers-3col"><thead><tr><th class="col-app">API service</th><th class="col-status">Status</th><th class="col-code">Code</th></tr></thead><tbody>';
              for (const p of providers) {
                const pok = p && p.ok;
                const statusText = pok ? 'online' : (p.error || 'offline');
                const codeText = (p.code !== undefined && p.code !== null) ? p.code : (pok ? 'OK' : '—');
                rowsHtml +=
                  '<tr>' +
                    '<td class="col-app"><span class="dot ' + (pok ? 'ok' : 'fail') + '"></span>' + p.label + '</td>' +
                    '<td class="col-status">' + statusText + '</td>' +
                    '<td class="col-code">' + codeText + '</td>' +
                  '</tr>';
              }
              rowsHtml += '</tbody></table>';
            }
            var fFails = providers.filter(function(p) { return !p || !p.ok; }).length;
            var fSt = sectionStatus(fFails);
            card.innerHTML =
              '<div class="name">' + c.label + '</div>' +
              '<div class="status ' + fSt.cls + '">' + fSt.label + '</div>' +
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

app.listen(PORT, HOST, () => {
  console.log(
    `Status board: http://localhost:${PORT}/  (LAN: http://<this-host>:${PORT}/) bound ${HOST}`
  );
});

