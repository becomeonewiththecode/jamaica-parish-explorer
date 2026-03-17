const express = require('express');
const http = require('http');

const app = express();
const PORT = process.env.STATUS_PORT || 5555;
const API_HOST = process.env.API_HOST || 'localhost';
const API_PORT = process.env.API_PORT || 3001;

const CHECKS = [
  { id: 'api', label: 'API health', path: '/api/health' },
  { id: 'weather', label: 'Island weather', path: '/api/weather/island' },
  { id: 'waves', label: 'Wave data', path: '/api/weather/waves' },
  { id: 'flights', label: 'Flights data', path: '/api/flights' },
  { id: 'vessels', label: 'Vessel data', path: '/api/vessels' },
  { id: 'cruise', label: 'Cruise schedules (Montego Bay)', path: '/api/ports/montego-bay-cruise-port/cruises' },
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

app.get('/status.json', async (req, res) => {
  const results = {};
  await Promise.all(
    CHECKS.map(async (c) => {
      results[c.id] = await runCheck(c.path);
    })
  );
  res.json({ timestamp: new Date().toISOString(), host: API_HOST, port: API_PORT, checks: results });
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
  <p class="updated">This page pings the main API for flights, weather, waves, vessels, and cruise data every 15 seconds and shows whether each service is ONLINE or OFFLINE.</p>
  <div class="grid" id="grid"></div>
  <script>
    const CHECKS = ${JSON.stringify(CHECKS.map(c => ({ id: c.id, label: c.label })))};
    async function refresh() {
      try {
        const res = await fetch('/status.json');
        const data = await res.json();
        document.getElementById('updated').textContent =
          'Last updated ' + new Date(data.timestamp).toLocaleString();
        document.getElementById('api-host').textContent = data.host + ':' + data.port;
        const grid = document.getElementById('grid');
        grid.innerHTML = '';
        for (const c of CHECKS) {
          const r = data.checks[c.id];
          const ok = r && r.ok;
          const card = document.createElement('div');
          card.className = 'card';
          card.innerHTML =
            '<div class="name">' + c.label + '</div>' +
            '<div class="status ' + (ok ? 'ok' : 'fail') + '">' +
              (ok ? 'ONLINE' : 'OFFLINE') +
            '</div>' +
            '<div class="meta">' +
              (r ? ('code: ' + (r.code || '-') + ' · ' + (r.ms || 0) + ' ms' + (r.error ? ' · ' + r.error : '')) : 'no data') +
            '</div>';
          grid.appendChild(card);
        }
      } catch (e) {
        document.getElementById('updated').textContent = 'Status fetch failed: ' + e.message;
      }
    }
    refresh();
    setInterval(refresh, 15000);
  </script>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log('Status board running on http://localhost:' + PORT);
});

