# Jamaica Parish Explorer

An interactive web application for exploring Jamaica's 14 parishes. Click any parish on the SVG map to zoom in and discover thousands of points of interest — restaurants, hotels, landmarks, beaches, hospitals, and more — each with photos, descriptions, and links.

![Jamaica Parish Explorer](https://img.shields.io/badge/React-19-blue) ![Express](https://img.shields.io/badge/Express-5-green) ![SQLite](https://img.shields.io/badge/SQLite-3-lightgrey)

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
- **Weather and waves** — parish weather (temp, wind, cloud, rain, sun) and coastal wave data on the map (zoom 9–10)
- **Vessel traffic** — live AIS-based vessel layer around Jamaica (AISStream.io) with ship icons, optional cruise-only filter, and ability to overlay flights, weather, and waves
- **Map base layers** — optional Thunderforest layers: **Transport** (roads, railways, transit), **Landscape** (terrain, nature, topography), **Neighbourhood** (streets, clear labels); one at a time in map controls (requires `VITE_THUNDERFOREST_API_KEY`)
- **Resilient API client** — failed fetches (parishes, places, flights, weather) are retried automatically (3 retries, exponential backoff)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 5, plain CSS |
| Backend | Express 5, Node.js |
| Database | SQLite via better-sqlite3 (WAL mode) |
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

The SQLite database is not included in the repo and must be built locally:

```bash
# 1. Initialize the database schema and seed parish data
npm run db:init

# 2. Fetch points of interest from OpenStreetMap (~4,300 places)
#    This queries the Overpass API — takes a few minutes
npm run fetch:places

# 3. Enrich places with photos and descriptions
#    Fetches images via Bing and descriptions via Wikipedia
#    Use 'all' flag to re-enrich everything: node server/db/enrich-places.js all
npm run enrich:places
```

### Running

```bash
# Development — starts both server (port 3001) and client (port 5173)
npm run dev

# Production build
npm run build
npm start
```

The dev server runs at **http://localhost:5173** with API requests proxied to the Express server on port 3001.

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
      connection.js             # SQLite connection (WAL mode)
      schema.sql                # Table definitions
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
| GET | `/api/ports/:id/cruises` | Upcoming cruise calls for a port (scraped from public cruise calendars) |

## Data Documentation

- **Flights:** see `docs/FLIGHT-DATA.md`
- **Weather and Waves:** see `docs/WEATHER-AND-WAVE-DATA.md`
- **Vessels (AISStream):** see `docs/VESSEL-DATA-AND-USAGE.md`

## Database Schema

- **parishes** — slug, name, county, population, capital, area, description, fill_color, svg_path
- **features** — notable features per parish (e.g. "Blue Mountains", "Port Royal")
- **places** — POIs with name, category, lat/lon, address, phone, website, cuisine, image_url, description
- **notes** — community notes per parish with author and timestamp

## License

ISC
