## Documentation Overview

This folder contains reference and architecture docs for the Jamaica Parish Explorer backend, status board, and data integrations.

## Table of Contents

- [Startup guide](./STARTUP-GUIDE.md)
- [Build process](./BUILD-PROCESS.md)
- [Build process diagram](./BUILD-PROCESS-DIAGRAM.md)
- [API reference](./API-REFERENCE.md)
- [Admin site](./ADMIN-SITE.md)
- [Status board](./STATUS-BOARD.md)
- [Status board diagram](./STATUS-BOARD-DIAGRAM.md)
- [Weather and wave data](./WEATHER-AND-WAVE-DATA.md)
- [Weather and waves diagram](./WEATHER-WAVES-DIAGRAM.md)
- [Flight data](./FLIGHT-DATA.md)
- [Flight data diagram](./FLIGHT-DATA-DIAGRAM.md)
- [Vessel data and usage](./VESSEL-DATA-AND-USAGE.md)
- [Vessel data diagram](./VESSEL-DATA-DIAGRAM.md)

### Setup and operations

- [`STARTUP-GUIDE.md`](./STARTUP-GUIDE.md) — how to run the app in every mode: dev (Vite HMR), PM2 production, Docker Compose, and bare `npm start`. Includes port reference and common troubleshooting.
- [`BUILD-PROCESS.md`](./BUILD-PROCESS.md) — how the client (Vite), server (native deps), database (init scripts), and Docker image (multi-stage) are built. Covers `JAMAICA_DATA_DIR`, `pmx: 'false'`, and layer caching.
- [`BUILD-PROCESS-DIAGRAM.md`](./BUILD-PROCESS-DIAGRAM.md) — Mermaid diagrams: Docker multi-stage build flow, runtime port/process architecture, and `JAMAICA_DATA_DIR` resolution.

### API reference

- [`API-REFERENCE.md`](./API-REFERENCE.md) — complete reference for all 24 API endpoints with parameters, responses, and usage. Interactive Swagger docs are served at `/api/docs`.

### Admin site

- [`ADMIN-SITE.md`](./ADMIN-SITE.md) — authenticated admin dashboard for monitoring PM2 processes, restarting services, and accessing Swagger/Status Board. Runs on port 5556.
- [`ADMIN-SITE-DIAGRAM.md`](./ADMIN-SITE-DIAGRAM.md) — Mermaid diagram of the admin login flow, including rate limiting and lockout behavior.

### Status board and monitoring

- [`STATUS-BOARD.md`](./STATUS-BOARD.md) — how the status board works, what it checks, how to run it, and how weather provider health is derived from `/api/health`.
- [`STATUS-BOARD-DIAGRAM.md`](./STATUS-BOARD-DIAGRAM.md) — Mermaid diagram of the status board architecture (browser → status server → API → external providers).

### Weather and waves

- [`WEATHER-AND-WAVE-DATA.md`](./WEATHER-AND-WAVE-DATA.md) — details on where weather and marine data comes from, update intervals, and endpoint behavior.
- [`WEATHER-WAVES-DIAGRAM.md`](./WEATHER-WAVES-DIAGRAM.md) — Mermaid diagram showing how weather and wave data flows from external providers through caches to the map.

### Flights and vessels

- [`FLIGHT-DATA.md`](./FLIGHT-DATA.md) — how scheduled and live flight data is fetched, cached, and exposed via `/api/flights` and related endpoints.
- [`FLIGHT-DATA-DIAGRAM.md`](./FLIGHT-DATA-DIAGRAM.md) — Mermaid diagram of the flight data flow (external providers → backend cache → `/api/flights` → map and airport views).
- [`VESSEL-DATA-AND-USAGE.md`](./VESSEL-DATA-AND-USAGE.md) — AIS/vessel data sources, how `/api/vessels` works, and guidance for safe usage and API keys.
- [`VESSEL-DATA-DIAGRAM.md`](./VESSEL-DATA-DIAGRAM.md) — Mermaid diagram of the vessel data flow (AISStream.io → in-memory snapshot → `/api/vessels` → map and port cruise views).

### Conventions

- All diagrams are written in **Mermaid** and can be rendered by compatible Markdown viewers.
- Paths in examples are relative to the project root (e.g. `server/routes/weather.js`, `client/src/api/weather.js`).

