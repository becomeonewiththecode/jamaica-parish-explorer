const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');

/** Same asset as the client app (`client/public/jamaican-flag-favicon.svg`). */
const ADMIN_FAVICON_SVG = path.join(__dirname, '..', 'client', 'public', 'jamaican-flag-favicon.svg');
const crypto = require('crypto');
const http = require('http');
const { exec } = require('child_process');
const multer = require('multer');

const uploadDbRestore = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.ADMIN_DB_RESTORE_MAX_BYTES || 536870912) },
});

function outboundLoopbackHost(raw, fallback = '127.0.0.1') {
  const h = (raw && String(raw).trim()) || fallback;
  return h === 'localhost' ? '127.0.0.1' : h;
}

const PORT = process.env.ADMIN_PORT || 5556;
const HOST = process.env.ADMIN_HOST || '0.0.0.0';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const API_HOST = outboundLoopbackHost(process.env.API_HOST);
/** Port the admin process uses to reach the API (loopback / internal). */
const API_PORT = Number(process.env.API_PORT) || 3001;
/** Port in dashboard links for browsers (e.g. Docker publish HOST_PORT→3001 → set this to HOST_PORT). */
const PUBLIC_API_PORT = Number(process.env.ADMIN_PUBLIC_API_PORT) || API_PORT;
const STATUS_PORT = process.env.STATUS_PORT || 5555;
const PUBLIC_STATUS_PORT = Number(process.env.ADMIN_PUBLIC_STATUS_PORT) || Number(STATUS_PORT) || 5555;
const ADMIN_RESTART_TOKEN = process.env.ADMIN_RESTART_TOKEN || '';
/** Host/port used to probe whether the Vite dev client is running (loopback). */
const CLIENT_HOST = outboundLoopbackHost(process.env.CLIENT_HOST);
const CLIENT_PORT = Number(process.env.CLIENT_PORT) || 5173;
/** Port in browser URL for the client when Vite is up (in case behind a proxy). */
const PUBLIC_CLIENT_PORT = Number(process.env.ADMIN_PUBLIC_CLIENT_PORT) || CLIENT_PORT;

if (!ADMIN_PASSWORD) {
  console.error('[Admin] ADMIN_PASSWORD is required in server/.env — refusing to start.');
  process.exit(1);
}

const COOKIE_SECRET = crypto.createHmac('sha256', ADMIN_PASSWORD).update('admin-session').digest('hex');

function makeToken(username) {
  return crypto.createHmac('sha256', COOKIE_SECRET).update(username).digest('hex');
}

// --- Login brute-force protection (dependency-light) ---
// We keep it in-memory (per admin process). This is fine for typical single-node setups.
const LOGIN_WINDOW_MS = Number(process.env.ADMIN_LOGIN_WINDOW_MS) || 15 * 60 * 1000; // 15m
const LOGIN_MAX_FAILURES = Number(process.env.ADMIN_LOGIN_MAX_FAILURES) || 10; // 10 failures
const LOGIN_LOCKOUT_MS = Number(process.env.ADMIN_LOGIN_LOCKOUT_MS) || 10 * 60 * 1000; // 10m lock

// key -> { failures: number[], lockUntil: number }
const loginFailuresByIp = new Map();

function getClientKey(req) {
  // Express' req.ip respects trust proxy config; fall back to socket remote address.
  return req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
}

function cleanupLoginFailures(now = Date.now()) {
  for (const [key, entry] of loginFailuresByIp.entries()) {
    const failures = Array.isArray(entry.failures) ? entry.failures : [];
    const stillInWindow = failures.some((t) => now - t <= LOGIN_WINDOW_MS);
    const locked = typeof entry.lockUntil === 'number' && entry.lockUntil > now;
    if (!locked && !stillInWindow) loginFailuresByIp.delete(key);
  }
}

// Periodic cleanup to avoid unbounded memory growth.
setInterval(() => cleanupLoginFailures(), LOGIN_WINDOW_MS).unref();

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

/** Multipart body for POST /api/admin/database/restore (avoids undici fetch+FormData issues). */
function buildDatabaseRestoreMultipart(sqlBuffer, originalname) {
  const boundary = `----nodeRestore${crypto.randomBytes(24).toString('hex')}`;
  const safeName = String(originalname || 'backup.sql').replace(/[\r\n"\\]/g, '_');
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="confirm"\r\n\r\n` +
    `RESTORE\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="backup"; filename="${safeName}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([Buffer.from(head, 'utf8'), sqlBuffer, Buffer.from(tail, 'utf8')]);
  return { boundary, body };
}

function proxyRestoreToApi(body, boundary) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: API_HOST,
      port: API_PORT,
      path: '/api/admin/database/restore',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.length),
        'X-Admin-Token': ADMIN_RESTART_TOKEN,
      },
      timeout: 30 * 60 * 1000,
    };
    const preq = http.request(opts, (pres) => {
      const chunks = [];
      pres.on('data', (c) => chunks.push(c));
      pres.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          data = { ok: false, error: text.slice(0, 800) || 'Non-JSON response from API' };
        }
        resolve({ status: pres.statusCode || 500, data });
      });
    });
    preq.on('error', (e) => {
      const cause = e.cause && e.cause.message ? ` (${e.cause.message})` : '';
      reject(new Error(`${e.code || 'ECONN'}: ${e.message}${cause} — check API_HOST/API_PORT (from inside Docker use the API service hostname, not 127.0.0.1)`));
    });
    preq.on('timeout', () => {
      preq.destroy();
      reject(new Error('Restore proxy timed out after 30 minutes'));
    });
    preq.write(body);
    preq.end();
  });
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

/** Probe whether the Vite dev client is reachable. Resolves quickly (1 s timeout). */
function probeClientAvailable() {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: CLIENT_HOST, port: CLIENT_PORT, path: '/', method: 'HEAD', timeout: 1000 },
      () => { req.destroy(); resolve(true); }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/favicon.svg', (req, res) => {
  res.type('image/svg+xml');
  res.sendFile(ADMIN_FAVICON_SVG, (err) => {
    if (err && !res.headersSent) res.sendStatus(404);
  });
});

// --- Login routes ---
app.get('/login', (req, res) => {
  const loginError = parseCookies(req).login_error;
  let errorHtml = '';
  if (loginError === 'locked') {
    errorHtml = '<div class="error">Too many failed attempts. Please try again later.</div>';
  } else if (loginError) {
    errorHtml = '<div class="error">Invalid username or password</div>';
  }
  res.type('html').send(loginPage(errorHtml));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body || {};

  const now = Date.now();
  const ipKey = getClientKey(req);
  cleanupLoginFailures(now);

  const entry = loginFailuresByIp.get(ipKey);
  if (entry && typeof entry.lockUntil === 'number' && entry.lockUntil > now) {
    res.writeHead(302, {
      'Set-Cookie': 'login_error=locked; HttpOnly; Path=/; Max-Age=30',
      Location: '/login',
    });
    return res.end();
  }

  if (username === ADMIN_USER && password === ADMIN_PASSWORD) {
    loginFailuresByIp.delete(ipKey); // successful login clears failures for that IP
    res.writeHead(302, {
      'Set-Cookie': [
        `admin_token=${makeToken(ADMIN_USER)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=86400`,
        'login_error=; HttpOnly; Path=/; Max-Age=0',
      ],
      Location: '/',
    });
    return res.end();
  }

  // Record failure in sliding window and lock if needed.
  const prevFailures = (entry && Array.isArray(entry.failures) ? entry.failures : []).filter((t) => now - t <= LOGIN_WINDOW_MS);
  prevFailures.push(now);
  let lockUntil = entry && typeof entry.lockUntil === 'number' ? entry.lockUntil : 0;
  if (prevFailures.length >= LOGIN_MAX_FAILURES) {
    lockUntil = now + LOGIN_LOCKOUT_MS;
    prevFailures.length = 0; // reset after lock triggers
  }
  loginFailuresByIp.set(ipKey, { failures: prevFailures, lockUntil });

  const lockedJustNow = lockUntil > now;
  res.writeHead(302, {
    'Set-Cookie': `login_error=${lockedJustNow ? 'locked' : 'invalid'}; HttpOnly; Path=/; Max-Age=30`,
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

app.get('/api/client-url', authMiddleware, async (req, res) => {
  const publicHost = publicHostname(req);
  const viteAvailable = await probeClientAvailable();
  const url = viteAvailable
    ? `http://${publicHost}:${PUBLIC_CLIENT_PORT}/`
    : `http://${publicHost}:${PUBLIC_API_PORT}/`;
  res.json({ url, viteAvailable });
});

app.get('/', authMiddleware, (req, res) => {
  res.type('html').send(dashboardPage(req));
});

// --- HTML Pages ---

function loginPage(errorHtml) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <title>Admin Login – Jamaica Explorer</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#050816; color:#f9fafb; margin:0; display:flex; align-items:center; justify-content:center; min-height:100vh; }
    .login-card { background:#0b1020; border:1px solid #1f2937; border-radius:0.75rem; padding:2.5rem; width:100%; max-width:360px; box-shadow:0 10px 30px rgba(0,0,0,0.4); }
    .login-brand { display:flex; flex-direction:column; align-items:center; gap:0.65rem; margin-bottom:0.35rem; }
    .login-brand h1 { margin:0; font-size:1.5rem; }
    .login-favicon { width:2.5rem; height:2.5rem; border-radius:0.45rem; flex-shrink:0; }
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
    <div class="login-brand">
      <img src="/favicon.svg" alt="" class="login-favicon" width="40" height="40">
      <h1>Admin Panel</h1>
    </div>
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

/** Hostname for links/iframe in the dashboard (browser must reach this host). */
function publicHostname(req) {
  const fromEnv = process.env.ADMIN_PUBLIC_HOST && String(process.env.ADMIN_PUBLIC_HOST).trim();
  if (fromEnv) return fromEnv;
  if (req && typeof req.hostname === 'string' && req.hostname.length > 0) return req.hostname;
  const raw = (req && req.headers && req.headers.host) || '';
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    return end > 1 ? raw.slice(1, end) : 'localhost';
  }
  const colon = raw.lastIndexOf(':');
  if (colon > 0 && !/]:/g.test(raw)) return raw.slice(0, colon);
  return raw || 'localhost';
}

function dashboardPage(req) {
  const publicHost = publicHostname(req);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <title>Admin Dashboard – Jamaica Explorer</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#050816; color:#f9fafb; margin:0; padding:1.5rem 2rem; }
    h1 { margin:0; font-size:1.6rem; }
    .header { display:flex; align-items:center; justify-content:space-between; margin-bottom:1.5rem; }
    .header-title-row { display:flex; align-items:center; gap:0.65rem; }
    .header-favicon { width:1.75rem; height:1.75rem; flex-shrink:0; border-radius:0.35rem; }
    .header-right { display:flex; align-items:center; gap:0.75rem; }
    .user-badge { font-size:0.8rem; color:#9ca3af; }
    .logout-btn { font-size:0.8rem; color:#f97373; text-decoration:none; padding:0.3rem 0.7rem; border:1px solid #7f1d1d; border-radius:0.4rem; }
    .logout-btn:hover { background:#7f1d1d; color:#fecaca; }

    .links { display:flex; gap:0.75rem; margin-bottom:1.5rem; flex-wrap:wrap; }
    .link-btn { display:inline-flex; align-items:center; gap:0.4rem; padding:0.5rem 1rem; background:#111827; border:1px solid #374151; border-radius:0.5rem; color:#e5e7eb; text-decoration:none; font-size:0.85rem; font-weight:500; }
    .link-btn:hover { background:#1f2937; border-color:#4b5563; }

    .admin-major-wrap { margin-bottom:1.5rem; }
    .admin-major-tab-bar { display:flex; gap:0.4rem; margin-bottom:0.85rem; border-bottom:1px solid #1f2937; flex-wrap:wrap; }
    .admin-major-tab {
      padding:0.55rem 1rem; font-size:0.88rem; font-weight:600; color:#9ca3af; background:transparent;
      border:none; border-bottom:3px solid transparent; margin-bottom:-1px; cursor:pointer;
      border-radius:0.4rem 0.4rem 0 0; font-family:inherit;
    }
    .admin-major-tab:hover { color:#e5e7eb; background:#111827; }
    .admin-major-tab[aria-selected="true"] { color:#e5e7eb; border-bottom-color:#818cf8; }
    .admin-major-tab:focus-visible { outline:2px solid #818cf8; outline-offset:2px; }
    .admin-major-panel { display:none; }
    .admin-major-panel.is-active { display:block; }

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

    .restart-console { display:flex; flex-direction:column; gap:0.5rem; min-height:0; }
    .restart-tab-bar { display:flex; gap:0.25rem; margin:0 0 0.5rem; border-bottom:1px solid #1f2937; flex-wrap:wrap; }
    .restart-tab {
      padding:0.45rem 0.85rem; font-size:0.78rem; font-weight:500; color:#9ca3af; background:transparent;
      border:none; border-bottom:2px solid transparent; margin-bottom:-1px; cursor:pointer;
      border-radius:0.35rem 0.35rem 0 0; font-family:inherit;
    }
    .restart-tab:hover { color:#e5e7eb; background:#111827; }
    .restart-tab[aria-selected="true"] { color:#e5e7eb; border-bottom-color:#6366f1; }
    .restart-tab:focus-visible { outline:2px solid #6366f1; outline-offset:2px; }
    .restart-tab-panel { display:none; flex-direction:column; gap:0.5rem; min-height:0; }
    .restart-tab-panel.is-active { display:flex; }
    .restart-console-hr { border:0; border-top:1px solid #1f2937; margin:0.35rem 0 0; padding:0; }
    .restart-console-sub { font-size:0.72rem; color:#6b7280; margin:0; line-height:1.35; }
    .restart-console-sub code { font-size:0.68rem; }
    .rebuild-progress-wrap { margin-top:0.35rem; }
    .rebuild-progress-meta { display:flex; justify-content:space-between; align-items:baseline; font-size:0.7rem; color:#9ca3af; margin-bottom:0.28rem; gap:0.5rem; flex-wrap:wrap; }
    #rebuild-progress-pct { font-variant-numeric:tabular-nums; color:#e5e7eb; font-weight:600; min-width:2.75rem; }
    #rebuild-progress-label { color:#9ca3af; text-align:right; flex:1; min-width:40%; }
    .rebuild-progress-track { height:6px; background:#111827; border-radius:3px; overflow:hidden; border:1px solid #1f2937; }
    .rebuild-progress-bar { height:100%; width:0%; background:linear-gradient(90deg,#4f46e5,#818cf8); transition:width 0.35s ease; }
    .rebuild-data-banner { font-size:0.72rem; line-height:1.45; margin:0.45rem 0 0.6rem; padding:0.5rem 0.65rem; border-radius:0.4rem; border:1px solid #374151; background:#111827; color:#d1d5db; }
    .rebuild-data-banner.warn { border-color:#b45309; background:#1c1917; color:#fde68a; }
    .rebuild-data-banner.ok { border-color:#166534; color:#bbf7d0; }
    .rebuild-data-banner.err { border-color:#991b1b; color:#fecaca; }
    .rebuild-sections { max-height:10rem; overflow-y:auto; margin:0.35rem 0 0.25rem; padding:0.3rem 0.35rem; background:#111827; border-radius:0.4rem; font-size:0.62rem; line-height:1.35; border:1px solid #1f2937; }
    .rebuild-section-row { display:flex; align-items:center; gap:0.35rem; padding:0.1rem 0; border-bottom:1px solid #1f2937; }
    .rebuild-section-row:last-child { border-bottom:none; }
    .rebuild-sec-idx { color:#6b7280; min-width:2.2rem; flex-shrink:0; font-variant-numeric:tabular-nums; }
    .rebuild-sec-name { color:#d1d5db; flex:1; word-break:break-word; min-width:0; }
    .rebuild-sec-badge { flex-shrink:0; font-size:0.55rem; padding:0.06rem 0.28rem; border-radius:0.2rem; text-transform:uppercase; letter-spacing:0.02em; }
    .badge-pending { background:#374151; color:#9ca3af; }
    .badge-running { background:#1e3a5f; color:#93c5fd; }
    .badge-ok { background:#064e3b; color:#6ee7b7; }
    .badge-error { background:#7f1d1d; color:#fecaca; }
    .rebuild-sec-detail { padding:0 0 0.12rem 2.5rem; font-size:0.58rem; color:#6b7280; line-height:1.3; }
    #rebuild-status { margin:0; padding:0.45rem 0.5rem; background:#111827; border-radius:0.4rem; font-size:0.62rem; color:#6b7280; white-space:pre-wrap; max-height:3.8rem; overflow:auto; line-height:1.3; border:1px solid #1f2937; }

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
    .pm2-card-wrap { max-width:42rem; }
    .ops-stack { display:flex; flex-direction:column; gap:1rem; max-width:42rem; }

    .db-tab-panel code { font-size:0.72rem; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-title-row">
      <img src="/favicon.svg" alt="" class="header-favicon" width="28" height="28">
      <h1>Admin Dashboard</h1>
    </div>
    <div class="header-right">
      <span class="user-badge">${esc(ADMIN_USER)}</span>
      <a href="/logout" class="logout-btn">Logout</a>
    </div>
  </div>

  <div class="links">
    <a href="http://${esc(publicHost)}:${PUBLIC_API_PORT}/api/docs/" target="_blank" class="link-btn">
      <span>&#128214;</span> Swagger Docs
    </a>
    <a href="http://${esc(publicHost)}:${PUBLIC_STATUS_PORT}/" target="_blank" class="link-btn">
      <span>&#128200;</span> Status Board
    </a>
    <a id="client-app-link" href="#" target="_blank" class="link-btn" style="opacity:0.5;pointer-events:none;">
      <span>&#127758;</span> Client App
    </a>
    <a href="http://${esc(publicHost)}:${PUBLIC_API_PORT}/api/health" target="_blank" class="link-btn">
      <span>&#128153;</span> Health Endpoint
    </a>
  </div>

  <div class="admin-major-wrap">
    <div class="admin-major-tab-bar" role="tablist" aria-label="Dashboard sections">
      <button type="button" class="admin-major-tab" role="tab" id="major-tab-ops" aria-selected="true" aria-controls="major-panel-ops" tabindex="0" onclick="setMajorTab('operations')">Operations</button>
      <button type="button" class="admin-major-tab" role="tab" id="major-tab-mapdata" aria-selected="false" aria-controls="major-panel-mapdata" tabindex="-1" onclick="setMajorTab('mapdata')">Map data rebuild</button>
      <button type="button" class="admin-major-tab" role="tab" id="major-tab-database" aria-selected="false" aria-controls="major-panel-database" tabindex="-1" onclick="setMajorTab('database')">Database</button>
    </div>
    <div id="major-panel-ops" class="admin-major-panel is-active" role="tabpanel" aria-labelledby="major-tab-ops">
      <div class="ops-stack">
        <div class="card pm2-card-wrap">
          <div class="card-title">PM2 Processes</div>
          <div id="pm2-table">Loading...</div>
          <div class="pm2-note">Auto-refreshes every 30s</div>
        </div>
        <div class="card pm2-card-wrap">
          <div class="card-title">Service restarts</div>
          <p style="font-size:0.8rem; color:#9ca3af; margin:0 0 0.65rem;">Restarts go through the API admin endpoint.</p>
          <div class="restart-group">
            <button class="restart-btn" onclick="doRestart('api')">Restart API</button>
            <button class="restart-btn" onclick="doRestart('status')">Restart Status Board</button>
            <button class="restart-btn" onclick="doRestart('admin')">Restart Admin</button>
            <button class="restart-btn danger" onclick="doRestart('all')">Restart All</button>
          </div>
          <div id="restart-result" style="font-size:0.78rem; color:#9ca3af; min-height:0; margin-top:0.5rem;"></div>
        </div>
      </div>
    </div>
    <div id="major-panel-mapdata" class="admin-major-panel" role="tabpanel" aria-labelledby="major-tab-mapdata">
      <div class="card pm2-card-wrap">
        <div class="card-title">Map data rebuild</div>
        <div class="restart-console">
          <div class="restart-tab-panel is-active">
            <p class="restart-console-sub"><strong>Map data</strong> — clears <code>places</code>, refetches OSM (slow). With bind-mounted Postgres, data persists on disk until you remove it or run this rebuild. Optional airports (no images). Enrich: <code>npm run enrich:places</code>. <strong>Notes</strong> in <code>notes</code> are not deleted.</p>
            <div id="rebuild-data-banner" class="rebuild-data-banner" style="display:none;" role="status"></div>
            <label style="display:flex; align-items:center; gap:0.4rem; font-size:0.75rem; color:#d1d5db; cursor:pointer; margin:0;">
              <input type="checkbox" id="rebuild-include-airports" style="flex-shrink:0;" />
              Airports (static)
            </label>
            <div class="restart-group">
              <button type="button" class="restart-btn" id="rebuild-map-btn" onclick="doRebuildMapData()">Rebuild map data</button>
            </div>
            <div id="rebuild-progress-wrap" class="rebuild-progress-wrap">
              <div class="rebuild-progress-meta">
                <span id="rebuild-progress-pct">—</span>
                <span id="rebuild-progress-label"></span>
              </div>
              <div class="rebuild-progress-track"><div id="rebuild-progress-bar" class="rebuild-progress-bar"></div></div>
            </div>
            <div id="rebuild-sections" class="rebuild-sections"></div>
            <pre id="rebuild-status">…</pre>
          </div>
        </div>
      </div>
    </div>
    <div id="major-panel-database" class="admin-major-panel" role="tabpanel" aria-labelledby="major-tab-database">
      <div class="card pm2-card-wrap db-tab-panel">
        <div class="card-title">Database</div>
        <div id="db-summary-wrap" style="margin:0 0 1rem;">
          <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; margin-bottom:0.45rem;">
            <span style="font-size:0.8rem; font-weight:600; color:#e5e7eb;">Is the database empty?</span>
            <button type="button" class="restart-btn" onclick="refreshDatabaseSummary()" style="padding:0.35rem 0.65rem; font-size:0.75rem;">Refresh counts</button>
          </div>
          <div id="db-summary-banner" class="rebuild-data-banner" style="display:none;" role="status"></div>
          <div id="db-summary-table" style="font-size:0.72rem; color:#9ca3af; margin-top:0.35rem;"></div>
        </div>
        <p style="font-size:0.8rem; color:#9ca3af; margin:0 0 0.75rem; line-height:1.45;">PostgreSQL. The API runs <code>pg_dump</code> / <code>psql</code> (install <code>postgresql-client</code> on the host or use the project Docker image). Backups include <code>--clean --if-exists</code> for round-trip restore.</p>
        <div class="restart-group" style="margin-bottom:0.85rem;">
          <button type="button" class="restart-btn" onclick="downloadDatabaseBackup()">Download backup (.sql)</button>
        </div>
        <hr class="restart-console-hr" />
        <p class="restart-console-sub" style="margin-bottom:0.55rem;"><strong>Restore</strong> replaces objects in the current database from a plain-SQL backup. You will be prompted again before upload.</p>
        <div style="display:flex; flex-wrap:wrap; gap:0.75rem; align-items:flex-end;">
          <div>
            <label for="restore-file" style="display:block; font-size:0.75rem; color:#9ca3af; margin-bottom:0.25rem;">Backup file</label>
            <input type="file" id="restore-file" accept=".sql,.txt,application/sql,text/plain" style="font-size:0.78rem; max-width:18rem;" />
          </div>
          <div>
            <label for="restore-confirm" style="display:block; font-size:0.75rem; color:#9ca3af; margin-bottom:0.25rem;">Type RESTORE</label>
            <input type="text" id="restore-confirm" placeholder="RESTORE" autocomplete="off" style="padding:0.45rem 0.5rem; border-radius:0.4rem; border:1px solid #374151; background:#111827; color:#f9fafb; width:9rem;" />
          </div>
          <button type="button" class="restart-btn danger" onclick="submitDatabaseRestore()">Restore database</button>
        </div>
        <pre id="restore-result" style="margin:0.55rem 0 0; font-size:0.68rem; color:#6b7280; white-space:pre-wrap; max-height:8rem; overflow:auto; border:1px solid #1f2937; border-radius:0.35rem; padding:0.4rem 0.5rem; background:#111827;"></pre>
      </div>
    </div>
  </div>

  <div id="toast" class="toast"></div>

  <script>
    function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    function setMajorTab(which) {
      var tabs = [
        { id: 'major-tab-ops', panel: 'major-panel-ops', key: 'operations' },
        { id: 'major-tab-mapdata', panel: 'major-panel-mapdata', key: 'mapdata' },
        { id: 'major-tab-database', panel: 'major-panel-database', key: 'database' },
      ];
      for (var i = 0; i < tabs.length; i++) {
        var t = document.getElementById(tabs[i].id);
        var p = document.getElementById(tabs[i].panel);
        if (!t || !p) continue;
        var sel = tabs[i].key === which;
        t.setAttribute('aria-selected', sel);
        t.tabIndex = sel ? 0 : -1;
        p.classList.toggle('is-active', sel);
      }
      if (which === 'database') refreshDatabaseSummary();
    }

    async function refreshDatabaseSummary() {
      var banner = document.getElementById('db-summary-banner');
      var tableEl = document.getElementById('db-summary-table');
      if (!banner || !tableEl) return;
      banner.style.display = 'block';
      banner.className = 'rebuild-data-banner';
      banner.textContent = 'Loading row counts…';
      tableEl.innerHTML = '';
      try {
        var res = await fetch('/api/database/summary');
        var d = await res.json().catch(function() { return {}; });
        if (!res.ok || !d.ok) {
          banner.classList.add('err');
          banner.textContent = d.error || ('HTTP ' + res.status);
          return;
        }
        var c = d.counts || {};
        var labelMap = {
          parishes: 'Parishes',
          places: 'Places (map POIs)',
          airports: 'Airports',
          notes: 'Notes',
          features: 'Features',
          flights: 'Flights',
          cruise_ports: 'Cruise ports',
          cruise_calls: 'Cruise calls',
        };
        var rows = [];
        for (var key in labelMap) {
          if (!Object.prototype.hasOwnProperty.call(c, key)) continue;
          var v = c[key];
          var cell = v == null ? '—' : Number(v).toLocaleString();
          rows.push('<tr><td>' + esc(labelMap[key]) + '</td><td style="text-align:right;font-variant-numeric:tabular-nums;">' + cell + '</td></tr>');
        }
        tableEl.innerHTML = '<table style="width:100%;max-width:22rem;"><tbody>' + rows.join('') + '</tbody></table>';
        if (d.isNonEmpty) {
          banner.classList.add('ok');
          if (d.hasContentData) {
            banner.textContent = 'Database is not empty: map POIs, airports, notes, and/or features have rows. See counts below.';
          } else {
            banner.textContent = 'Database is not empty (e.g. parish seed), but places, airports, notes, and features are all zero.';
          }
        } else {
          banner.classList.add('warn');
          banner.textContent = 'Tracked tables show zero rows (unusual if schema is applied), or counts could not be read.';
        }
      } catch (e) {
        banner.classList.add('err');
        banner.textContent = 'Request failed: ' + e.message;
      }
    }

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
      var selfRestart = (target === 'admin' || target === 'all');
      var btns = document.querySelectorAll('.restart-btn');
      btns.forEach(function(b) { b.disabled = true; });
      try {
        var res = await fetch('/api/restart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: target }),
        });
        var data = await res.json().catch(function() { return {}; });
        if (data.ok) {
          showToast('Restarted ' + target + ' successfully', true);
        } else {
          var detail = data.error || data.message || ('HTTP ' + res.status);
          showToast('Restart failed: ' + detail, false);
        }
      } catch (e) {
        // Connection errors are expected when restarting — the target process dies mid-request
        showToast('Restart ' + target + ' initiated (process restarting)', true);
      }
      btns.forEach(function(b) { b.disabled = false; });
      if (selfRestart) {
        setTimeout(function() { location.reload(); }, 3000);
      } else {
        setTimeout(refreshPm2, 2000);
      }
    }

    async function refreshClientUrl() {
      try {
        var r = await fetch('/api/client-url');
        var d = await r.json();
        var link = document.getElementById('client-app-link');
        link.href = d.url;
        link.style.opacity = '';
        link.style.pointerEvents = '';
        if (!d.viteAvailable) {
          link.title = 'Vite dev server is offline — linking to production app';
        }
      } catch (e) { /* leave link disabled if fetch fails */ }
    }

    var rebuildPollTimer = null;
    var rebuildPollDelayMs = 4000;
    var rebuildDataSnapshot = null;

    function updateRebuildDataBanner(snap) {
      var ban = document.getElementById('rebuild-data-banner');
      if (!ban) return;
      if (!snap) {
        ban.style.display = 'none';
        ban.innerHTML = '';
        return;
      }
      var lines = [];
      if (snap.placesQueryable && snap.placesCount != null) {
        ban.className = 'rebuild-data-banner ' + (snap.placesCount > 0 ? 'warn' : 'ok');
        lines.push('<strong>places</strong>: ' + esc(String(snap.placesCount.toLocaleString())) + ' row(s)');
        if (snap.airportsCount != null) lines.push('<strong>airports</strong>: ' + esc(String(snap.airportsCount.toLocaleString())));
        if (snap.notesCount != null) lines.push('<strong>notes</strong>: ' + esc(String(snap.notesCount.toLocaleString())) + ' (unchanged by rebuild)');
        lines.push(esc(snap.wipeWarning || ''));
      } else {
        ban.className = 'rebuild-data-banner err';
        lines.push(esc(snap.wipeWarning || 'Could not read database snapshot.'));
        if (snap.placesCountError) lines.push(esc(snap.placesCountError));
      }
      ban.innerHTML = lines.join('<br/>');
      ban.style.display = 'block';
    }
    function scheduleRebuildPoll() {
      clearTimeout(rebuildPollTimer);
      rebuildPollTimer = setTimeout(function() { pollRebuildStatus(); }, rebuildPollDelayMs);
    }
    async function pollRebuildStatus() {
      var pre = document.getElementById('rebuild-status');
      try {
        var res = await fetch('/api/rebuild-inventory/status');
        var d = await res.json().catch(function() { return {}; });
        if (!pre) return;
        if (!d.ok && res.status === 403) {
          pre.textContent = 'Forbidden (check ADMIN_RESTART_TOKEN matches API).';
          scheduleRebuildPoll();
          return;
        }
        if (d.dataSnapshot) {
          rebuildDataSnapshot = d.dataSnapshot;
          updateRebuildDataBanner(d.dataSnapshot);
        }
        rebuildPollDelayMs = d.inProgress ? 1500 : 4000;

        var pct = typeof d.progressPercent === 'number' ? Math.max(0, Math.min(100, d.progressPercent)) : null;
        var bar = document.getElementById('rebuild-progress-bar');
        var pctEl = document.getElementById('rebuild-progress-pct');
        var labelEl = document.getElementById('rebuild-progress-label');
        var secEl = document.getElementById('rebuild-sections');
        if (bar) bar.style.width = (pct != null ? pct : 0) + '%';
        if (pctEl) pctEl.textContent = pct != null ? pct + '%' : '—';
        if (labelEl) {
          if (d.inProgress && d.currentStepLabel) labelEl.textContent = d.currentStepLabel;
          else if (d.phase && d.phase !== 'idle') labelEl.textContent = d.phase === 'done' ? 'Last run finished' : ('Phase: ' + d.phase);
          else labelEl.textContent = '';
        }
        if (secEl) {
          if (d.sections && d.sections.length) {
            var sh = '';
            for (var si = 0; si < d.sections.length; si++) {
              var s = d.sections[si];
              var st = s.status || 'pending';
              var badge = 'badge-pending';
              if (st === 'running') badge = 'badge-running';
              else if (st === 'ok') badge = 'badge-ok';
              else if (st === 'error') badge = 'badge-error';
              sh += '<div class="rebuild-section-row"><span class="rebuild-sec-idx">' + esc(String(s.index)) + '/' + esc(String(s.total)) + '</span><span class="rebuild-sec-name">' + esc(s.category) + '</span><span class="rebuild-sec-badge ' + badge + '">' + esc(st) + '</span></div>';
              var detail = '';
              if (s.message) detail = esc(s.message);
              else if (st === 'ok' && (s.found != null || s.insertedAttempted != null)) {
                var parts = [];
                if (s.found != null) parts.push(s.found + ' found');
                if (s.insertedAttempted != null) parts.push(s.insertedAttempted + ' new rows');
                detail = esc(parts.join(', '));
              } else if (st === 'error' && s.httpStatus) detail = esc('HTTP ' + s.httpStatus);
              if (detail) sh += '<div class="rebuild-sec-detail">' + detail + '</div>';
            }
            secEl.innerHTML = sh;
          } else {
            secEl.innerHTML = '<div style="color:#6b7280;font-size:0.62rem;">No section data (start a rebuild or refresh).</div>';
          }
        }

        var lines = [];
        lines.push('inProgress: ' + !!d.inProgress);
        if (d.phase) lines.push('phase: ' + d.phase);
        lines.push('lastStartedAt: ' + (d.lastStartedAt || '—'));
        lines.push('lastFinishedAt: ' + (d.lastFinishedAt || '—'));
        if (d.lastError) lines.push('lastError: ' + d.lastError);
        if (d.lastSummary) lines.push('lastSummary: ' + JSON.stringify(d.lastSummary, null, 2));
        pre.textContent = lines.join('\\n');
      } catch (e) {
        if (pre) pre.textContent = 'Poll failed: ' + e.message;
      }
      scheduleRebuildPoll();
    }

    async function doRebuildMapData() {
      var snap = rebuildDataSnapshot;
      try {
        var resFresh = await fetch('/api/rebuild-inventory/status');
        var dFresh = await resFresh.json().catch(function() { return {}; });
        if (dFresh.ok && dFresh.dataSnapshot) {
          snap = dFresh.dataSnapshot;
          rebuildDataSnapshot = snap;
          updateRebuildDataBanner(snap);
        }
      } catch (e) { /* use cached snap */ }

      var n = snap && snap.placesQueryable && typeof snap.placesCount === 'number' ? snap.placesCount : null;
      var wipeNeedsConfirm = !snap || !snap.placesQueryable || n === null || n > 0;
      var msg;
      if (n != null && n > 0) {
        msg = 'Rebuild will DELETE all ' + n.toLocaleString() + ' rows in the places table and refetch from OpenStreetMap.\\n\\nPostgreSQL files persist on disk (e.g. Docker bind mounts) until you remove them or run this rebuild.\\n\\nContinue?';
      } else if (snap && snap.placesQueryable && n === 0) {
        msg = 'The places table is empty. Rebuild will load POIs from OpenStreetMap (slow). Continue?';
      } else {
        msg = 'Could not read the places row count. The rebuild still runs DELETE FROM places, then refetches from OSM. Continue only if you intend a full map POI repopulation.';
      }
      if (!confirm(msg)) return;

      var btn = document.getElementById('rebuild-map-btn');
      var airports = document.getElementById('rebuild-include-airports');
      if (btn) btn.disabled = true;
      try {
        var res = await fetch('/api/rebuild-inventory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            includeAirports: !!(airports && airports.checked),
            clearPlaces: true,
            confirmWipe: wipeNeedsConfirm,
          }),
        });
        var data = await res.json().catch(function() { return {}; });
        if (data.ok) {
          showToast('Rebuild started — watch status below and server logs', true);
          setMajorTab('mapdata');
        } else {
          if (data.code === 'CONFIRM_WIPE_REQUIRED' && data.dataSnapshot) {
            rebuildDataSnapshot = data.dataSnapshot;
            updateRebuildDataBanner(data.dataSnapshot);
          }
          showToast((data.error || 'HTTP ' + res.status), false);
        }
        pollRebuildStatus();
      } catch (e) {
        showToast('Request failed: ' + e.message, false);
      }
      if (btn) btn.disabled = false;
    }

    async function downloadDatabaseBackup() {
      var pre = document.getElementById('restore-result');
      if (pre) pre.textContent = '';
      try {
        var res = await fetch('/api/database/backup');
        if (!res.ok) {
          var errData = await res.json().catch(function() { return {}; });
          showToast(errData.error || ('HTTP ' + res.status), false);
          if (pre) pre.textContent = errData.detail || errData.error || '';
          return;
        }
        var blob = await res.blob();
        var cd = res.headers.get('Content-Disposition') || '';
        var name = 'jamaica-db-backup.sql';
        var m = cd.match(/filename="([^"]+)"/i);
        if (!m) m = cd.match(/filename=([^;\\s]+)/i);
        if (m) {
          name = m[1].trim().replace(/^"|"$/g, '');
          try { name = decodeURIComponent(name); } catch (e) {}
        }
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('Backup downloaded', true);
      } catch (e) {
        showToast('Backup failed: ' + e.message, false);
      }
    }

    async function submitDatabaseRestore() {
      var f = document.getElementById('restore-file');
      var c = document.getElementById('restore-confirm');
      var pre = document.getElementById('restore-result');
      if (pre) pre.textContent = '';
      if (!f || !f.files || !f.files[0]) {
        showToast('Choose a backup .sql file', false);
        return;
      }
      if (!c || String(c.value).trim() !== 'RESTORE') {
        showToast('Type RESTORE in the confirm field', false);
        return;
      }
      if (!confirm('This will run the SQL backup against the live database and replace existing tables/data. Continue?')) return;
      showToast('Restore running…', true);
      var fd = new FormData();
      fd.append('backup', f.files[0]);
      fd.append('confirm', 'RESTORE');
      try {
        var ctrl = new AbortController();
        var t = setTimeout(function() { ctrl.abort(); }, 30 * 60 * 1000);
        var res = await fetch('/api/database/restore', {
          method: 'POST',
          body: fd,
          signal: ctrl.signal,
          credentials: 'same-origin',
        });
        clearTimeout(t);
        var data = await res.json().catch(function() { return {}; });
        if (pre && data.detail) pre.textContent = String(data.detail);
        if (data.ok) {
          showToast('Database restored', true);
          refreshDatabaseSummary();
        } else {
          showToast((data.error || ('HTTP ' + res.status)), false);
        }
      } catch (e) {
        showToast('Restore failed: ' + (e.name === 'AbortError' ? 'timed out (30m)' : e.message), false);
      }
    }

    refreshClientUrl();
    refreshPm2();
    setInterval(refreshPm2, 30000);
    pollRebuildStatus();
  </script>
</body>
</html>`;
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
    // ECONNRESET / EPIPE mean the API process was killed mid-request — the expected
    // outcome when restarting the API itself.  Treat it as success so the dashboard
    // shows "Restarted successfully" rather than a false failure toast.
    if (e && (e.code === 'ECONNRESET' || e.code === 'EPIPE')) {
      if (!res.headersSent) res.json({ ok: true, note: 'Connection reset — target is restarting' });
      return;
    }
    const msg = e && e.code ? e.code + ' (' + (e.message || '') + ')' : e && e.message ? e.message : 'proxy error';
    if (!res.headersSent) res.status(502).json({ ok: false, error: 'Cannot reach API at ' + API_HOST + ':' + API_PORT + ': ' + msg });
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    res.status(504).json({ ok: false, error: 'Request to API timed out' });
  });

  proxyReq.write(postData);
  proxyReq.end();
});

app.get('/api/rebuild-inventory/status', authMiddleware, (req, res) => {
  const options = {
    hostname: API_HOST,
    port: API_PORT,
    path: '/api/admin/rebuild-inventory/status',
    method: 'GET',
    headers: { 'X-Admin-Token': ADMIN_RESTART_TOKEN },
    timeout: 15000,
  };
  const proxyReq = http.request(options, (proxyRes) => {
    let body = '';
    proxyRes.on('data', (chunk) => {
      body += chunk;
    });
    proxyRes.on('end', () => {
      try {
        res.status(proxyRes.statusCode).json(JSON.parse(body));
      } catch {
        res.status(proxyRes.statusCode).json({ ok: false, error: body });
      }
    });
  });
  proxyReq.on('error', (e) => {
    const msg = e && e.code ? e.code + ' (' + (e.message || '') + ')' : e && e.message ? e.message : 'proxy error';
    if (!res.headersSent) {
      res.status(502).json({ ok: false, error: 'Cannot reach API: ' + msg });
    }
  });
  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) res.status(504).json({ ok: false, error: 'Request to API timed out' });
  });
  proxyReq.end();
});

app.post('/api/rebuild-inventory', authMiddleware, (req, res) => {
  const postData = JSON.stringify(req.body || {});
  const options = {
    hostname: API_HOST,
    port: API_PORT,
    path: '/api/admin/rebuild-inventory',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': ADMIN_RESTART_TOKEN,
      'Content-Length': Buffer.byteLength(postData),
    },
    timeout: 30000,
  };
  const proxyReq = http.request(options, (proxyRes) => {
    let body = '';
    proxyRes.on('data', (chunk) => {
      body += chunk;
    });
    proxyRes.on('end', () => {
      try {
        res.status(proxyRes.statusCode).json(JSON.parse(body));
      } catch {
        res.status(proxyRes.statusCode).json({ ok: false, error: body });
      }
    });
  });
  proxyReq.on('error', (e) => {
    const msg = e && e.code ? e.code + ' (' + (e.message || '') + ')' : e && e.message ? e.message : 'proxy error';
    if (!res.headersSent) {
      res.status(502).json({ ok: false, error: 'Cannot reach API: ' + msg });
    }
  });
  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) res.status(504).json({ ok: false, error: 'Request to API timed out' });
  });
  proxyReq.write(postData);
  proxyReq.end();
});

app.get('/api/database/backup', authMiddleware, (req, res) => {
  const options = {
    hostname: API_HOST,
    port: API_PORT,
    path: '/api/admin/database/backup',
    method: 'GET',
    headers: { 'X-Admin-Token': ADMIN_RESTART_TOKEN },
  };
  const proxyReq = http.request(options, (proxyRes) => {
    res.status(proxyRes.statusCode);
    const cd = proxyRes.headers['content-disposition'];
    const ct = proxyRes.headers['content-type'];
    if (cd) res.setHeader('Content-Disposition', cd);
    if (ct) res.setHeader('Content-Type', ct);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (e) => {
    if (!res.headersSent) {
      res.status(502).json({ ok: false, error: 'Cannot reach API: ' + (e.message || String(e)) });
    }
  });
  proxyReq.end();
});

app.get('/api/database/summary', authMiddleware, (req, res) => {
  const options = {
    hostname: API_HOST,
    port: API_PORT,
    path: '/api/admin/database/summary',
    method: 'GET',
    headers: { 'X-Admin-Token': ADMIN_RESTART_TOKEN },
    timeout: 15000,
  };
  const proxyReq = http.request(options, (proxyRes) => {
    let body = '';
    proxyRes.on('data', (chunk) => {
      body += chunk;
    });
    proxyRes.on('end', () => {
      try {
        res.status(proxyRes.statusCode).json(JSON.parse(body));
      } catch {
        res.status(proxyRes.statusCode).json({ ok: false, error: body });
      }
    });
  });
  proxyReq.on('error', (e) => {
    const msg = e && e.code ? e.code + ' (' + (e.message || '') + ')' : e && e.message ? e.message : 'proxy error';
    if (!res.headersSent) {
      res.status(502).json({ ok: false, error: 'Cannot reach API: ' + msg });
    }
  });
  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) res.status(504).json({ ok: false, error: 'Request to API timed out' });
  });
  proxyReq.end();
});

app.post('/api/database/restore', authMiddleware, uploadDbRestore.single('backup'), async (req, res) => {
  if (req.body && req.body.confirm !== 'RESTORE') {
    return res.status(400).json({ ok: false, error: 'confirm must be RESTORE' });
  }
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ ok: false, error: 'Missing backup file (field name: backup)' });
  }
  if (!ADMIN_RESTART_TOKEN) {
    return res.status(503).json({ ok: false, error: 'ADMIN_RESTART_TOKEN is not set on admin/API' });
  }
  try {
    const { boundary, body } = buildDatabaseRestoreMultipart(req.file.buffer, req.file.originalname);
    const { status, data } = await proxyRestoreToApi(body, boundary);
    res.status(status).json(data);
  } catch (e) {
    res.status(502).json({
      ok: false,
      error: e && e.message ? e.message : String(e),
      detail:
        'Admin could not reach the API restore endpoint. If the API runs in another Docker container, set API_HOST to that service name (not 127.0.0.1).',
    });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ ok: false, error: 'Backup file too large for admin proxy' });
  }
  console.error('[Admin]', err);
  if (!res.headersSent) {
    res.status(500).json({ ok: false, error: err.message || 'Internal error' });
  }
});

app.listen(PORT, HOST, () => {
  console.log(
    `[Admin] http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} · API proxy ${API_HOST}:${API_PORT}/api/admin/restart`
  );
});
