## Option 4: Manual deployment on a VM

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
   RAPIDAPI_KEY=your_rapidapi_key
   OPENSKY_CLIENT_ID=your_opensky_client_id
   OPENSKY_CLIENT_SECRET=your_opensky_client_secret
   AISSTREAM_API_KEY=your_aisstream_api_key
   ```

   Example `client/.env`:

   ```bash
   VITE_THUNDERFOREST_API_KEY=your_thunderforest_api_key
   ```

3. Run:

```bash
chmod +x deployment/option4-vm/setup-server.sh
chmod +x deployment/option4-vm/deploy.sh

deployment/option4-vm/setup-server.sh
deployment/option4-vm/deploy.sh
```

4. Check service status:

```bash
sudo systemctl status jamaica-parish-explorer
```

By default the app listens on port `3000`. Use a reverse proxy (Nginx, Caddy, etc.) or a firewall rule to expose it on port 80/443 as needed.

