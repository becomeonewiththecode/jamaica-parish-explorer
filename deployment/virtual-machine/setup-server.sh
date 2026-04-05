#!/usr/bin/env bash
set -euo pipefail

# Basic Ubuntu/Debian server bootstrap for running Jamaica Parish Explorer directly on a VM.

sudo apt-get update
sudo apt-get install -y \
  curl \
  git \
  postgresql-client \
  build-essential

# Install Node.js (LTS) via NodeSource
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# Create application user
sudo useradd -m -s /bin/bash jamaica || true

echo "Server prerequisites installed. Clone the repo as user 'jamaica' and run deploy.sh."

