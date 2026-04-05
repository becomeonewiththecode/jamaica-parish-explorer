const http = require('http');
const { spawn } = require('child_process');

function outboundLoopbackHost(raw, fallback = '127.0.0.1') {
  const h = (raw && String(raw).trim()) || fallback;
  return h === 'localhost' ? '127.0.0.1' : h;
}
const API_HOST = outboundLoopbackHost(process.env.API_HOST);
const API_PORT = process.env.API_PORT || 3001;
const CLIENT_PORT = process.env.CLIENT_PORT || 5173;
const STATUS_PORT = process.env.STATUS_PORT || 5555;

function check(path, port) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = http.get(
      { host: API_HOST, port, path, timeout: 4000 },
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

function startProcess(label, script) {
  console.log(`[init-dev] Starting ${label} via "${script}"...`);
  const child = spawn('npm', ['run', script], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  child.on('exit', (code) => {
    console.log(`[init-dev] "${script}" exited with code ${code}`);
  });
}

(async () => {
  // Check API / server
  const api = await check('/api/health', API_PORT);
  if (api.ok) {
    console.log(`[init-dev] API already up on ${API_HOST}:${API_PORT} (code ${api.code})`);
  } else {
    startProcess('server+client (dev)', 'dev');
  }

  // Check client (Vite) root
  const client = await check('/', CLIENT_PORT);
  if (client.ok) {
    console.log(`[init-dev] Client already up on http://localhost:${CLIENT_PORT}`);
  } else if (api.ok) {
    // If API was already running but client is not, start dev:client only
    startProcess('client-only (dev:client)', 'dev:client');
  }

  // Check status board
  const status = await check('/status.json', STATUS_PORT);
  if (status.ok) {
    console.log(`[init-dev] Status board already up on http://localhost:${STATUS_PORT}`);
  } else {
    startProcess('status board', 'dev:status');
  }
})();

