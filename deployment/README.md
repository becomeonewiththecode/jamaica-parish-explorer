## Deployment Options

This folder contains multiple deployment options for Jamaica Parish Explorer. You can choose the one that best matches your target environment.

## Table of Contents

- [Docker Compose (testing / single server)](#docker-compose-testing-single-server)
- [Virtual Machine (Node.js + systemd)](#virtual-machine-nodejs-systemd)
- [Kubernetes (production / internet-facing)](#kubernetes-production-internet-facing)

### Docker Compose (testing / single server)

- **Folder**: `deployment/docker-compose`
- **What it is**: Single-server deployment using Docker Compose. Runs the full app (Express API + built React client) in one container.
- **Good for**: Local or remote testing, simple single-node deployments with Docker.
- **Docs**: See [deployment/docker-compose/README.md](./docker-compose/README.md) for environment variables, build, and `docker compose up -d --build` instructions.

### Virtual Machine (Node.js + systemd)

- **Folder**: `deployment/virtual-machine`
- **What it is**: Runs the app directly on a Linux VM using Node.js and a `systemd` service.
- **Good for**: A straightforward “app on a box” setup when you control a single VM and don’t want containers.
- **Docs**: See [deployment/virtual-machine/README.md](./virtual-machine/README.md) for server bootstrap (`setup-server.sh`), env setup (`server/.env`, `client/.env`), and service management.

### Kubernetes (production / internet-facing)

- **Folder**: `deployment/kubernetes`
- **What it is**: Production-grade deployment on a Kubernetes cluster using a `Deployment`, `Service`, and `Ingress`.
- **Good for**: Internet-facing production, scaling, and environments where you already run Kubernetes.
- **Docs**: See [deployment/kubernetes/README.md](./kubernetes/README.md) for image build/push commands, manifests, secrets, and rollout/rollback steps.

