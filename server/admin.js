require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const crypto = require('crypto');
const http = require('http');
const { exec } = require('child_process');

const PORT = process.env.ADMIN_PORT || 5556;
const HOST = process.env.ADMIN_HOST || '0.0.0.0';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const API_HOST = process.env.API_HOST || 'localhost';
const API_PORT = process.env.API_PORT || 3001;
const STATUS_PORT = process.env.STATUS_PORT || 5555;
const ADMIN_RESTART_TOKEN = process.env.ADMIN_RESTART_TOKEN || '';

if (!ADMIN_PASSWORD) {
  console.error('[Admin] ADMIN_PASSWORD is required in server/.env — refusing to start.');
  process.exit(1);
}

const COOKIE_SECRET = crypto.createHmac('sha256', ADMIN_PASSWORD).update('admin-session').digest('hex');

function makeToken(username) {
  return crypto.createHmac('sha256', COOKIE_SECRET).update(username).digest('hex');
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const cookies = {};
  raw.split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) cookies[k] = v.join('=');
  });
  return cookies;
}

function isAuthenticated(req) {
  const cookies = parseCookies(req);
  return cookies.admin_token === makeToken(ADMIN_USER);
}

function authMiddleware(req, res, next) {
  if (isAuthenticated(req)) return next();
  res.writeHead(302, { Location: '/login' });
  res.end();
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- PM2 status (reused from status-board.js) ---
function fetchPm2Status() {
  return new Promise((resolve) => {
    exec('pm2 jlist --silent', { maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) {
        return resolve({ ok: false, processes: [], error: err.message });
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
                uptime: typeof env.pm_uptime === 'number' ? env.pm_uptime : null,
              };
            })
          : [];
        const allOnline = processes.length > 0 && processes.every(p => p.status === 'online');
        resolve({ ok: allOnline, processes });
      } catch (e) {
        resolve({ ok: false, processes: [], error: 'Failed to parse pm2 output' });
      }
    });
  });
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// --- Login routes ---
app.get('/login', (req, res) => {
  const error = parseCookies(req).login_error ? '<div class="error">Invalid username or password</div>' : '';
  res.type('html').send(loginPage(error));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASSWORD) {
    res.writeHead(302, {
      'Set-Cookie': [
        `admin_token=${makeToken(ADMIN_USER)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=86400`,
        'login_error=; HttpOnly; Path=/; Max-Age=0',
      ],
      Location: '/',
    });
    return res.end();
  }
  res.writeHead(302, {
    'Set-Cookie': 'login_error=1; HttpOnly; Path=/; Max-Age=5',
    Location: '/login',
  });
  res.end();
});

app.get('/logout', (req, res) => {
  res.writeHead(302, {
    'Set-Cookie': 'admin_token=; HttpOnly; Path=/; Max-Age=0',
    Location: '/login',
  });
  res.end();
});

// --- Authenticated routes ---
app.get('/api/pm2', authMiddleware, async (req, res) => {
  const pm2 = await fetchPm2Status();
  res.json(pm2);
});

app.get('/', authMiddleware, (req, res) => {
  res.type('html').send(dashboardPage());
});

// --- HTML Pages ---

function loginPage(errorHtml) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin Login – Jamaica Explorer</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#050816; color:#f9fafb; margin:0; display:flex; align-items:center; justify-content:center; min-height:100vh; }
    .login-card { background:#0b1020; border:1px solid #1f2937; border-radius:0.75rem; padding:2.5rem; width:100%; max-width:360px; box-shadow:0 10px 30px rgba(0,0,0,0.4); }
    h1 { margin:0 0 0.25rem; font-size:1.5rem; }
    .subtitle { color:#9ca3af; font-size:0.85rem; margin-bottom:1.5rem; }
    label { display:block; font-size:0.85rem; color:#d1d5db; margin-bottom:0.3rem; }
    input[type="text"], input[type="password"] { width:100%; padding:0.6rem 0.75rem; border:1px solid #374151; border-radius:0.5rem; background:#111827; color:#f9fafb; font-size:0.9rem; margin-bottom:1rem; box-sizing:border-box; outline:none; }
    input:focus { border-color:#6366f1; }
    button { width:100%; padding:0.65rem; background:#4f46e5; color:#fff; border:none; border-radius:0.5rem; font-size:0.95rem; font-weight:600; cursor:pointer; }
    button:hover { background:#4338ca; }
    .error { background:#7f1d1d; color:#fecaca; padding:0.6rem 0.75rem; border-radius:0.5rem; font-size:0.85rem; margin-bottom:1rem; }
  </style>
</head>
<body>
  <div class="login-card">
    <h1>Admin Panel</h1>
    <div class="subtitle">Jamaica Parish Explorer</div>
    ${errorHtml || ''}
    <form method="POST" action="/login">
      <label for="username">Username</label>
      <input type="text" id="username" name="username" autocomplete="username" required autofocus>
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autocomplete="current-password" required>
      <button type="submit">Sign In</button>
    </form>
  </div>
</body>
</html>`;
}

function dashboardPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin Dashboard – Jamaica Explorer</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#050816; color:#f9fafb; margin:0; padding:1.5rem 2rem; }
    h1 { margin:0; font-size:1.6rem; }
    .header { display:flex; align-items:center; justify-content:space-between; margin-bottom:1.5rem; }
    .header-right { display:flex; align-items:center; gap:0.75rem; }
    .user-badge { font-size:0.8rem; color:#9ca3af; }
    .logout-btn { font-size:0.8rem; color:#f97373; text-decoration:none; padding:0.3rem 0.7rem; border:1px solid #7f1d1d; border-radius:0.4rem; }
    .logout-btn:hover { background:#7f1d1d; color:#fecaca; }

    .links { display:flex; gap:0.75rem; margin-bottom:1.5rem; flex-wrap:wrap; }
    .link-btn { display:inline-flex; align-items:center; gap:0.4rem; padding:0.5rem 1rem; background:#111827; border:1px solid #374151; border-radius:0.5rem; color:#e5e7eb; text-decoration:none; font-size:0.85rem; font-weight:500; }
    .link-btn:hover { background:#1f2937; border-color:#4b5563; }

    .grid { display:grid; grid-template-columns: 1fr 1fr; gap:1rem; margin-bottom:1.5rem; }
    @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
    .card { padding:1rem 1.1rem; border-radius:0.75rem; background:#0b1020; border:1px solid #1f2937; box-shadow:0 10px 30px rgba(0,0,0,0.4); }
    .card-title { font-weight:600; font-size:0.95rem; margin-bottom:0.75rem; }

    table { width:100%; border-collapse:collapse; }
    th, td { padding:0.4rem 0.5rem; font-size:0.82rem; text-align:left; }
    th { color:#9ca3af; font-weight:600; border-bottom:1px solid #1f2937; }
    td { border-bottom:1px solid #111827; }
    .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:0.4rem; vertical-align:middle; }
    .dot.online { background:#4ade80; box-shadow:0 0 4px #4ade80; }
    .dot.stopped { background:#f97373; box-shadow:0 0 4px #f97373; }
    .dot.errored { background:#fcd34d; box-shadow:0 0 4px #fcd34d; }

    .restart-group { display:flex; gap:0.5rem; flex-wrap:wrap; }
    .restart-btn { padding:0.5rem 1rem; border:1px solid #374151; border-radius:0.5rem; background:#111827; color:#e5e7eb; font-size:0.82rem; font-weight:500; cursor:pointer; }
    .restart-btn:hover { background:#1f2937; border-color:#4b5563; }
    .restart-btn.danger { border-color:#7f1d1d; color:#fca5a5; }
    .restart-btn.danger:hover { background:#7f1d1d; }
    .restart-btn:disabled { opacity:0.5; cursor:not-allowed; }

    .toast { position:fixed; bottom:1.5rem; right:1.5rem; padding:0.7rem 1.2rem; border-radius:0.5rem; font-size:0.85rem; font-weight:500; z-index:100; opacity:0; transition:opacity 0.3s; pointer-events:none; }
    .toast.show { opacity:1; }
    .toast.ok { background:#064e3b; color:#6ee7b7; border:1px solid #065f46; }
    .toast.fail { background:#7f1d1d; color:#fecaca; border:1px solid #991b1b; }

    .pm2-note { font-size:0.75rem; color:#6b7280; margin-top:0.5rem; }

    .status-iframe-wrap { margin-top:1rem; }
    .status-iframe-wrap summary { cursor:pointer; font-size:0.85rem; color:#9ca3af; margin-bottom:0.5rem; }
    .status-iframe-wrap iframe { width:100%; height:600px; border:1px solid #1f2937; border-radius:0.5rem; background:#050816; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Admin Dashboard</h1>
    <div class="header-right">
      <span class="user-badge">${esc(ADMIN_USER)}</span>
      <a href="/logout" class="logout-btn">Logout</a>
    </div>
  </div>

  <div class="links">
    <a href="http://${getExternalHost()}:${API_PORT}/api/docs/" target="_blank" class="link-btn">
      <span>&#128214;</span> Swagger Docs
    </a>
    <a href="http://${getExternalHost()}:${STATUS_PORT}/" target="_blank" class="link-btn">
      <span>&#128200;</span> Status Board
    </a>
    <a href="http://${getExternalHost()}:5173/" target="_blank" class="link-btn">
      <span>&#127758;</span> Client App
    </a>
    <a href="http://${getExternalHost()}:${API_PORT}/api/health" target="_blank" class="link-btn">
      <span>&#128153;</span> Health Endpoint
    </a>
  </div>

  <div class="grid">
    <div class="card">
      <div class="card-title">PM2 Processes</div>
      <div id="pm2-table">Loading...</div>
      <div class="pm2-note">Auto-refreshes every 30s</div>
    </div>
    <div class="card">
      <div class="card-title">Restart Controls</div>
      <p style="font-size:0.8rem; color:#9ca3af; margin:0 0 0.75rem;">Sends restart command via the API server's admin endpoint.</p>
      <div class="restart-group">
        <button class="restart-btn" onclick="doRestart('api')">Restart API</button>
        <button class="restart-btn" onclick="doRestart('status')">Restart Status Board</button>
        <button class="restart-btn" onclick="doRestart('admin')">Restart Admin</button>
        <button class="restart-btn danger" onclick="doRestart('all')">Restart All</button>
      </div>
      <div id="restart-result" style="margin-top:0.75rem; font-size:0.8rem;"></div>
    </div>
  </div>

  <details class="status-iframe-wrap">
    <summary>Inline Status Board</summary>
    <iframe src="http://${getExternalHost()}:${STATUS_PORT}/" loading="lazy"></iframe>
  </details>

  <div id="toast" class="toast"></div>

  <script>
    function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    function formatUptime(ts) {
      if (!ts) return '-';
      var ms = Date.now() - ts;
      var s = Math.floor(ms / 1000);
      if (s < 60) return s + 's';
      var m = Math.floor(s / 60);
      if (m < 60) return m + 'm';
      var h = Math.floor(m / 60);
      if (h < 24) return h + 'h ' + (m % 60) + 'm';
      var d = Math.floor(h / 24);
      return d + 'd ' + (h % 24) + 'h';
    }

    async function refreshPm2() {
      try {
        var res = await fetch('/api/pm2');
        var data = await res.json();
        if (!data.processes || !data.processes.length) {
          document.getElementById('pm2-table').innerHTML = '<div style="color:#9ca3af; font-size:0.82rem;">No PM2 processes found</div>';
          return;
        }
        var html = '<table><thead><tr><th>Application</th><th>Status</th><th>CPU</th><th>Memory</th><th>Restarts</th><th>Uptime</th></tr></thead><tbody>';
        for (var p of data.processes) {
          var dotCls = p.status === 'online' ? 'online' : p.status === 'errored' ? 'errored' : 'stopped';
          html += '<tr>' +
            '<td><span class="dot ' + dotCls + '"></span>' + esc(p.name) + '</td>' +
            '<td>' + esc(p.status) + '</td>' +
            '<td>' + esc(p.cpu || '-') + '</td>' +
            '<td>' + esc(p.memory || '-') + '</td>' +
            '<td>' + (p.restarts != null ? p.restarts : '-') + '</td>' +
            '<td>' + formatUptime(p.uptime) + '</td>' +
            '</tr>';
        }
        html += '</tbody></table>';
        document.getElementById('pm2-table').innerHTML = html;
      } catch (e) {
        document.getElementById('pm2-table').innerHTML = '<div style="color:#f97373; font-size:0.82rem;">Failed to fetch PM2 status</div>';
      }
    }

    function showToast(msg, ok) {
      var t = document.getElementById('toast');
      t.textContent = msg;
      t.className = 'toast show ' + (ok ? 'ok' : 'fail');
      clearTimeout(t._timer);
      t._timer = setTimeout(function() { t.className = 'toast'; }, 4000);
    }

    async function doRestart(target) {
      if (target === 'all' && !confirm('Restart ALL PM2 processes? This will briefly interrupt all services.')) return;
      if (target === 'admin') {
        // Admin restart: use PM2 directly since restarting self via API proxy won't return a response
        try {
          var res = await fetch('/api/restart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: 'admin' }),
          });
        } catch (e) { /* expected — the process restarts */ }
        showToast('Admin restart initiated — reloading in 3s...', true);
        setTimeout(function() { location.reload(); }, 3000);
        return;
      }
      var btns = document.querySelectorAll('.restart-btn');
      btns.forEach(function(b) { b.disabled = true; });
      try {
        var res = await fetch('/api/restart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: target }),
        });
        var data = await res.json();
        if (data.ok) {
          showToast('Restarted ' + target + ' successfully', true);
        } else {
          showToast('Restart failed: ' + (data.error || 'unknown error'), false);
        }
      } catch (e) {
        showToast('Restart request failed: ' + e.message, false);
      }
      btns.forEach(function(b) { b.disabled = false; });
      setTimeout(refreshPm2, 2000);
    }

    refreshPm2();
    setInterval(refreshPm2, 30000);
  </script>
</body>
</html>`;
}

function getExternalHost() {
  // Use the hostname that the user would access from their browser
  // In a real deployment this would be configurable; for LAN use, localhost works
  return 'localhost';
}

// --- Support admin self-restart via PM2 ---
app.post('/api/restart', authMiddleware, (req, res) => {
  const target = (req.body && req.body.target) || 'all';

  // Self-restart: use PM2 directly
  if (target === 'admin') {
    res.json({ ok: true, command: 'pm2 restart jamaica-admin' });
    setTimeout(() => {
      exec('pm2 restart jamaica-admin', () => {});
    }, 500);
    return;
  }

  // Proxy to API server for api/status/all restarts
  const postData = JSON.stringify({ target });
  const options = {
    hostname: API_HOST,
    port: API_PORT,
    path: '/api/admin/restart',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': ADMIN_RESTART_TOKEN,
      'Content-Length': Buffer.byteLength(postData),
    },
    timeout: 10000,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    let body = '';
    proxyRes.on('data', (chunk) => { body += chunk; });
    proxyRes.on('end', () => {
      try {
        res.status(proxyRes.statusCode).json(JSON.parse(body));
      } catch {
        res.status(proxyRes.statusCode).json({ ok: false, error: body });
      }
    });
  });

  proxyReq.on('error', (e) => {
    res.status(502).json({ ok: false, error: e.message });
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    res.status(504).json({ ok: false, error: 'Request to API timed out' });
  });

  proxyReq.write(postData);
  proxyReq.end();
});

app.listen(PORT, HOST, () => {
  console.log(`[Admin] Dashboard running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
