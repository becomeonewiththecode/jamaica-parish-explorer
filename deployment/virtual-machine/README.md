## Virtual Machine: Manual deployment on a VM

This option runs the app directly on a Linux VM (e.g. Ubuntu) using Node.js and a `systemd` service.

### Files

- `setup-server.sh` — installs Node.js, SQLite, and basic build tools on a fresh VM
- `deploy.sh` — clones or updates the repo in `/opt/jamaica-parish-explorer`, builds, and restarts the service
- `jamaica-parish-explorer.service` — `systemd` unit for keeping the app running

### Usage

1. **SSH into your VM** and copy this folder to the server (or clone the repo there).
2. (Optional but recommended) create environment files:

   - Backend: `server/.env`
   - Frontend build-time env: `client/.env`

   Example `server/.env`:

   ```bash
   NODE_ENV=production
   PORT=3001
   HOST=0.0.0.0

   # Flight and vessel data
   RAPIDAPI_KEY=your_rapidapi_key
   OPENSKY_CLIENT_ID=your_opensky_client_id
   OPENSKY_CLIENT_SECRET=your_opensky_client_secret
   AISSTREAM_API_KEY=your_aisstream_api_key

   # Admin dashboard authentication (required)
   ADMIN_USER=admin
   ADMIN_PASSWORD=your_strong_random_password
   ADMIN_RESTART_TOKEN=your_restart_token

   # Optional: store DB + caches outside the repo (e.g. survives re-deploy)
   # JAMAICA_DATA_DIR=/var/lib/jamaica-parish-explorer
   ```

   Example `client/.env`:

   ```bash
   VITE_THUNDERFOREST_API_KEY=your_thunderforest_api_key
   ```

3. Run:

```bash
chmod +x deployment/virtual-machine/setup-server.sh
chmod +x deployment/virtual-machine/deploy.sh

deployment/virtual-machine/setup-server.sh
deployment/virtual-machine/deploy.sh
```

4. Check service status:

```bash
sudo systemctl status jamaica-parish-explorer
```

By default the app API listens on port `3001`. Use a reverse proxy (Nginx, Caddy, etc.) or a firewall rule to expose it on port 80/443 as needed.

### PM2 (optional — adds status board and admin dashboard)

The `systemd` service above runs only the API (`npm start`). If you also want the **status board** (port 5555) and **admin dashboard** (port 5556), install PM2 and use `ecosystem.config.js` instead:

```bash
npm install -g pm2
cd /opt/jamaica-parish-explorer
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # follow the printed instructions to register with systemd
```

> **Note:** PM2 v6 on nvm-managed Node.js requires `pmx: 'false'` in `ecosystem.config.js` for the API process (already set) to prevent a `libnode.so` load error from its APM module. If you see `ERR_DLOPEN_FAILED` on `jamaica-api`, verify that setting is present.
