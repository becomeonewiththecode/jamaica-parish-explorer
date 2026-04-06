#!/usr/bin/env bash
set -euo pipefail

# Deploy/update the app on a plain VM.

APP_DIR="/opt/jamaica-parish-explorer"
REPO_URL="https://github.com/becomeonewiththecode/jamaica-parish-explorer.git"

if [ ! -d "$APP_DIR/.git" ]; then
  sudo mkdir -p "$APP_DIR"
  sudo chown "$(whoami)":"$(whoami)" "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
else
  cd "$APP_DIR"
  git pull --ff-only
fi

cd "$APP_DIR"

npm install
npm run build

sudo cp deployment/virtual-machine/jamaica-parish-explorer.service /etc/systemd/system/jamaica-parish-explorer.service
sudo systemctl daemon-reload
sudo systemctl enable jamaica-parish-explorer
sudo systemctl restart jamaica-parish-explorer

echo "Deployment complete. Check status with: sudo systemctl status jamaica-parish-explorer"

