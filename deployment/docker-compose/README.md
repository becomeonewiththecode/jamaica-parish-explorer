## Docker Compose: Single-server deployment

This option runs the full Jamaica Parish Explorer stack in a single Docker container on one server using `docker-compose`.

### Files

- `Dockerfile` — builds a production image for the full app (server + built client)
- `docker-compose.yml` — defines the service, ports, and volume for persistent data
- `.env.example` — template for environment variables (copy to `.env` before use)

### Usage

```bash
cd deployment/docker-compose

# 1. Create your environment file
cp .env.example .env
edit .env

# 2. Build and start the stack
docker compose up -d --build

# 3. View logs
docker compose logs -f

# 4. Stop the stack
docker compose down
```

By default, the app is exposed on port 80 of the host (`HOST_PORT`), forwarding to port 3000 in the container (`PORT`). You can change these via the `.env` file.

