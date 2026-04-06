# Jamaica Parish Explorer

An interactive web application for exploring Jamaica's 14 parishes. Click any parish on the SVG map to zoom in and discover thousands of points of interest — restaurants, hotels, landmarks, beaches, hospitals, and more — each with photos, descriptions, and links.

![Jamaica Parish Explorer](https://img.shields.io/badge/React-19-blue) ![Express](https://img.shields.io/badge/Express-5-green) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue)

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Running (local or VM)](#running-local-or-vm)
- [Environment configuration](#environment-configuration)
- [Deployment notes (Docker, VMs, Kubernetes)](#deployment-notes-docker-vms-kubernetes)
- [Project Structure](#project-structure)
- [API Endpoints](#api-endpoints)
- [Data Documentation](#data-documentation)
- [Database Schema](#database-schema)
- [License](#license)

## Features

- **Interactive SVG map** of Jamaica with all 14 parishes, hover highlights, and click-to-zoom
- **Parish detail panel** showing population, capital, area, county, description, and notable features
- **4,300+ points of interest** sourced from OpenStreetMap across 14 categories (attractions, restaurants, hotels, hospitals, beaches, etc.)
- **Place search** — search all places across Jamaica from a global search bar; results navigate to the parish and highlight the location with a star
- **Place popups** with photos, descriptions, website links, menu links (for restaurants), and Google Maps driving directions
- **Community notes** — users can leave notes on any parish
- **Category filtering** — filter visible map markers by type when viewing a parish
- **Live flights** — scheduled arrivals/departures (AeroDataBox) and live radar (OpenSky, adsb.lol) for Jamaica airports; plane icons on the map with altitude-based coloring
- **Airport detail** — full airport info and flight board, or flight-only view (when Live Flights is on) with Jamaica time and weather at the airport
- **Weather and waves** — island-wide parish weather with centred glyph clusters (temperature, wind, cloud, rain, sun) for all 14 parishes at zoom 9–11, refreshed every 20 minutes when data changes, plus coastal wave data
- **Vessel traffic** — live AIS-based vessel layer around Jamaica (AISStream.io) with ship icons, optional cruise-only filter, and ability to overlay flights, weather, and waves; port popup shows upcoming cruise calls with an AIS column (In port / not in port) and warns when a ship expected today does not report as docked
- **Map base layers** — optional Thunderforest layers: **Transport** (roads, railways, transit), **Landscape** (terrain, nature, topography), **Neighbourhood** (streets, clear labels); one at a time in map controls (requires `VITE_THUNDERFOREST_API_KEY`)
- **Admin database tools** — authenticated admin dashboard (port **5556**): open the **Database** tab to download **`.sql`** backups or upload restores (proxied to the API with `pg_dump` / `psql`; requires **`ADMIN_RESTART_TOKEN`**)
- **Safe map-data rebuild** — admin **Map data rebuild** tab shows live **`places`** counts and requires **`confirmWipe`** before wiping POIs; see [`docs/ADMIN-SITE.md`](./docs/ADMIN-SITE.md)
- **Resilient API client** — failed fetches (parishes, places, flights, weather) are retried automatically (3 retries, exponential backoff)
- **Status board** — a small dashboard on port `5555` that checks API health, flights, weather, waves, vessels, and cruise schedule endpoints. Weather, wave, and flight provider health are derived from the backend's `/api/health` response instead of calling those providers directly from the board. The same **`/api/health`** payload also includes **`mapDataRebuild`** (OpenStreetMap ingest job progress) for monitoring, even though the status board UI does not render it yet.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 5, plain CSS |
| Backend | Express 5, Node.js |
| Database | PostgreSQL via `pg` — `DATABASE_URL` or `POSTGRES_*` variables (see below) |
| Map Data | GeoJSON parish boundaries, OpenStreetMap POIs |
| Images | Bing image search, Wikipedia, Wikimedia Commons |

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
# Clone the repository
git clone https://github.com/becomeonewiththecode/jamaica-parish-explorer.git
cd jamaica-parish-explorer

# Install root dependencies
npm install

# Install server dependencies
cd server && npm install && cd ..

# Install client dependencies
cd client && npm install && cd ..
```

### Database Setup

PostgreSQL is required. In **`server/.env`**, either set **`DATABASE_URL`** (full URI) **or** the discrete variables **`POSTGRES_USER`**, **`POSTGRES_PASSWORD`**, **`POSTGRES_HOST`**, **`POSTGRES_PORT`**, **`POSTGRES_DB`** — the server builds the URI from those when `DATABASE_URL` is unset (passwords are URL-encoded automatically). Docker Compose passes **`POSTGRES_HOST=postgres`** into the app container; see **`deployment/docker-compose/.env.example`**.

When the **API server starts**, it runs **`applySchema` + parish seed** (`server/index.js`). **`npm run db:init`** is the usual first-time bootstrap from the project root (same DDL + seed without starting the HTTP server).

Migrating an old SQLite `jamaica.db` is documented in [`docs/DATA-MIGRATION-SQLITE-TO-POSTGRES.md`](./docs/DATA-MIGRATION-SQLITE-TO-POSTGRES.md).

```bash
# 1. Initialize the database schema and seed parish data
npm run db:init

# 2. Fetch points of interest from OpenStreetMap (~4,300 places)
#    This queries the Overpass API — can take many minutes (polite pacing + retries; see docs)
npm run fetch:places

# 3. Enrich places with photos and descriptions
#    Fetches images via Bing and descriptions via Wikipedia
#    Use 'all' flag to re-enrich everything: node server/db/enrich-places.js all
npm run enrich:places
```

### Running (local or VM)

```bash
# Development — ensures server (3001), client (5173), and status board (5555) are running
npm run init

# Production build
npm run build
npm start

# Optional: run API + status board under PM2 (on a bare VM/server)
# (after deploying code and installing dependencies on the server, and setting NODE_ENV=production)
pm2 start ecosystem.config.js
pm2 save
```

The dev server runs at **http://localhost:5173** with API requests proxied to the Express server on port 3001.

### Environment configuration

- Backend runtime config lives in `server/.env` (read by Express at startup), e.g.:
  - **`DATABASE_URL`** — PostgreSQL connection string, **or** omit it and set **`POSTGRES_USER`**, **`POSTGRES_PASSWORD`**, **`POSTGRES_HOST`**, **`POSTGRES_PORT`**, **`POSTGRES_DB`**
  - `PORT`, `HOST`
  - `RAPIDAPI_KEY`, `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET`
  - `AISSTREAM_API_KEY` (AISStream vessel layer)
  - `TRACKED_SHIP_MMSIS` (optional: comma-separated MMSIs to track globally, e.g. `311263000` for Adventure of the Seas; see [`docs/VESSEL-DATA-AND-USAGE.md`](./docs/VESSEL-DATA-AND-USAGE.md))
  - `ADMIN_RESTART_TOKEN` (optional: strong shared secret for `POST /api/admin/restart` and **admin database backup/restore** routes; same token on admin + API; see [`docs/STATUS-BOARD.md`](./docs/STATUS-BOARD.md) and [`docs/API-REFERENCE.md`](./docs/API-REFERENCE.md))
- Frontend build-time config lives in `client/.env` (read by Vite at build; only `VITE_*` keys are exposed to the browser), e.g.:
  - `VITE_THUNDERFOREST_API_KEY`

`AISSTREAM_API_KEY` is **server-only** and should not be placed in `client/.env`.

### Deployment notes (Docker, VMs, Kubernetes)

- **PM2 is optional** and primarily useful on a **single VM / bare-metal server** where you want Node processes (API + status board) to stay up independently of any shell session.
- In **Docker** or **Kubernetes**, the recommended pattern is:
  - Run one Node process per container (no PM2).
  - Let the orchestrator (Docker, docker-compose, Kubernetes, systemd, etc.) handle restarts and scaling.
  - You can still keep `ecosystem.config.js` and the `/api/admin/restart` endpoint, but they are not required in those environments.
- The core app (Express API + built React frontend) does **not depend** on PM2: it can be started with plain `node server/index.js` or `npm start` in any environment.

### Optional: Map base layers (Transport, Landscape, Neighbourhood)

The map includes toggles for **Transport**, **Landscape**, and **Neighbourhood** base layers (one active at a time). They use [Thunderforest](https://www.thunderforest.com/) tiles and require a free API key. To enable them, create `client/.env` with:

```bash
VITE_THUNDERFOREST_API_KEY=your_api_key_here
```

Get a key at [thunderforest.com](https://www.thunderforest.com/); the free tier is sufficient for development.

## Project Structure

```
project_jamaica/
  client/                     # React frontend (Vite)
    public/
      jamaica-parishes.geojson  # Parish boundary data
    src/
      api/
        parishes.js             # Parish, places, notes, flights, airports
        weather.js              # Weather and waves
        fetchWithRetry.js       # Fetch wrapper with retry on failure
      components/
        MapSection.jsx          # Full Jamaica map + zoom dispatch
        ParishZoomView.jsx      # Zoomed parish view with place markers
        InfoSection.jsx         # Left panel with parish details
        ParishDetail.jsx        # Parish stats, description, features
        PlacePopup.jsx          # Place detail modal with photo
        SearchBar.jsx           # Global place search
        NotesPanel.jsx          # Community notes display
        NoteForm.jsx            # Note submission form
        PlacesPanel.jsx         # Filterable place list
      hooks/
        useParish.js            # Parish data fetching hook
  server/                     # Express API
    index.js                    # Server entry point
    db/
      connection.js             # Re-exports PostgreSQL pool helpers (pg-query)
      schema.postgresql.sql     # Table definitions (applied on boot / db:init)
      init.js                   # Schema + parish seed data
      fetch-places.js           # OpenStreetMap data fetcher
      enrich-places.js          # Image + description enrichment
    routes/
      parishes.js               # GET /api/parishes, /api/parishes/:slug
      places.js                 # Place search, categories, website-image
      notes.js                  # CRUD for community notes
      flights.js                # Flights API (scheduled + live radar)
      weather.js                # Weather and marine wave data
      airports.js               # Airport metadata and details
      vessels.js                # Live vessel traffic (AISStream.io)
      port-cruises.js           # Scraped cruise schedules per port (CruiseDig / CruiseMapper)
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Uptime, weather/wave/flight provider health, and **`mapDataRebuild`** (OSM map-data job status) |
| GET | `/api/parishes` | List all parishes (lightweight) |
| GET | `/api/parishes/:slug` | Full parish detail + features |
| GET | `/api/parishes/:slug/places` | Places in a parish (optional `?category=`) |
| GET | `/api/parishes/:slug/notes` | Notes for a parish |
| POST | `/api/parishes/:slug/notes` | Add a note (`{ author, content }`) |
| DELETE | `/api/notes/:id` | Delete a note |
| GET | `/api/places/search?q=` | Search places by name |
| GET | `/api/places/categories` | List categories with counts |
| GET | `/api/places/all` | All places (lightweight) |
| GET | `/api/places/website-image?url=` | Extract og:image from a URL |
| GET | `/api/flights` | Cached flight data (scheduled + live radar) |
| GET | `/api/airports` | List Jamaica airports |
| GET | `/api/weather?lat=&lon=` | Weather at a point |
| GET | `/api/weather/parish/:slug` | Weather for a parish |
| GET | `/api/weather/island` | Island-wide weather (14 parishes) |
| GET | `/api/weather/waves` | Coastal wave data |
| GET | `/api/vessels` | Live vessel snapshot near Jamaica (AISStream.io; optional `?type=cruise`) |
| GET | `/api/ports/:id/cruises` | Upcoming cruise calls for a port (CruiseDig/CruiseMapper, persisted in PostgreSQL and refreshed when older than ~6h) |

**Admin-only (require `X-Admin-Token` = `ADMIN_RESTART_TOKEN`):** `POST /api/admin/restart`, database backup/restore/summary, rebuild-inventory routes — see [`docs/API-REFERENCE.md`](./docs/API-REFERENCE.md). The admin UI on port **5556** proxies backup/restore and **`GET /api/database/summary`** after login.

## Data Documentation

- **Database, map POIs, Overpass, Docker `data/postgres` vs `data/jamaica`, startup seed (14 parishes / 70 features), admin rebuild:** see [`docs/DATABASE-AND-MAP-DATA.md`](./docs/DATABASE-AND-MAP-DATA.md)
- **Flights:** see [`docs/FLIGHT-DATA.md`](./docs/FLIGHT-DATA.md)
- **Weather and Waves:** see [`docs/WEATHER-AND-WAVE-DATA.md`](./docs/WEATHER-AND-WAVE-DATA.md)
- **Vessels (AISStream):** see [`docs/VESSEL-DATA-AND-USAGE.md`](./docs/VESSEL-DATA-AND-USAGE.md)
- **Status board:** see [`docs/STATUS-BOARD.md`](./docs/STATUS-BOARD.md)

## Database Schema

- **parishes** — slug, name, county, population, capital, area, description, fill_color, svg_path
- **features** — notable features per parish (seeded from `server/db/init.js`; **70** rows = 5 landmarks × 14 parishes, reapplied on API boot when missing)
- **places** — POIs with name, category, lat/lon, address, phone, website, cuisine, image_url, description
- **notes** — community notes per parish with author and timestamp
- **cruise_ports** — logical cruise ports (e.g. Montego Bay, Ocho Rios, Falmouth) with code, name, city, lat/lon, and source URL
- **cruise_calls** — scheduled and observed cruise ship calls per port (ship name, operator, MMSI when known, source, ETA text/UTC, status, first/last seen, timestamps)

## License

ISC
