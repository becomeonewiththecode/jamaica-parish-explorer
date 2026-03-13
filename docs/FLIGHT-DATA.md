# Flight Data — How It Works

This document explains how flight data is gathered, stored, and displayed in the Jamaica Parish Explorer.

---

## Data Sources

Flight data comes from two external APIs, each covering different airports:

### AeroDataBox (Primary — Scheduled Flights)
- **Provider:** AeroDataBox via RapidAPI
- **Airports covered:** Norman Manley Intl (KIN) and Sangster Intl (MBJ)
- **Data type:** Scheduled arrivals and departures — includes flight number, airline, aircraft type, origin/destination, scheduled time, and status
- **Authentication:** RapidAPI key (`RAPIDAPI_KEY` in `.env`)
- **Rate limits:** BASIC plan allows 1 request/second. Requests are sent sequentially with a 1.1-second delay between airports
- **API endpoint:** `https://aerodatabox.p.rapidapi.com/flights/airports/icao/{ICAO}`

### OpenSky Network (Secondary — Live Radar)
- **Provider:** OpenSky Network
- **Airports covered:** Ian Fleming Intl (OCJ) and Tinson Pen (KTP)
- **Data type:** Live ADS-B radar positions of aircraft within a ~25 km bounding box of each airport
- **Authentication:** OAuth2 client credentials flow (Keycloak). Token is cached for 30 minutes and refreshed automatically
- **Token endpoint:** `https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token`
- **API endpoint:** `https://opensky-network.org/api/states/all?lamin=...&lamax=...&lomin=...&lomax=...`
- **Fallback role:** If AeroDataBox fails entirely, OpenSky is also used as a Jamaica-wide fallback (bounding box covering the full island)
- **Note:** Caribbean ADS-B receiver coverage is sparse — OpenSky may return zero aircraft even when flights are active

### adsb.lol (Tertiary — Live Radar, Free)
- **Provider:** adsb.lol (open ADS-B data aggregator)
- **Airports covered:** Ian Fleming Intl (OCJ) and Tinson Pen (KTP) — used as fallback when OpenSky returns no data
- **Data type:** Live ADS-B transponder data within a 25 nautical mile radius of each airport
- **Authentication:** None required (free, no API key)
- **API endpoint:** `https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{radius_nm}`
- **Data includes:** Callsign, aircraft type, registration, operator, lat/lon, altitude, ground speed, heading, barometric rate
- **Advantage:** Aggregates data from multiple ADS-B feeder networks, providing better Caribbean coverage than OpenSky alone

### Airport Coverage Summary

| Airport | IATA | ICAO | Data Source | Data Type |
|---------|------|------|-------------|-----------|
| Norman Manley International | KIN | MKJP | AeroDataBox | Scheduled flights |
| Sangster International | MBJ | MKJS | AeroDataBox | Scheduled flights |
| Ian Fleming International | OCJ | MKBS | OpenSky → adsb.lol | Live radar |
| Tinson Pen Aerodrome | KTP | MKTP | OpenSky → adsb.lol | Live radar |

---

## Environment Variables

All credentials are stored in `server/.env` (gitignored):

```
RAPIDAPI_KEY=<your-rapidapi-key>
OPENSKY_CLIENT_ID=<your-opensky-client-id>
OPENSKY_CLIENT_SECRET=<your-opensky-client-secret>
```

- **RAPIDAPI_KEY** — Obtained from [RapidAPI AeroDataBox](https://rapidapi.com/aedbx-aedbx/api/aerodatabox)
- **OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET** — Created in your [OpenSky Network account](https://opensky-network.org) under API client settings

---

## Data Gathering

### Polling Schedule

The server fetches flight data on a **15-minute interval** using background polling (`setInterval`). The first fetch runs immediately on server boot.

### Fetch Sequence (per poll cycle)

1. **AeroDataBox** — Query KIN and MBJ sequentially (1.1s delay between requests to respect rate limit)
2. **OpenSky fallback** — If AeroDataBox returns zero flights, query OpenSky for all Jamaica airspace
3. **Small airports (OCJ, KTP)** — For each airport:
   - Try **OpenSky** first (~25 km bounding box)
   - If OpenSky returns zero aircraft, try **adsb.lol** (25 nautical mile radius)

### Live Radar Flight Classification

Since OpenSky and adsb.lol provide raw aircraft positions (not schedule data), flights near OCJ and KTP are classified by vertical rate:

**OpenSky:**
- Descending (vertical rate < -1 m/s) or on ground → **arrival**
- Ascending (vertical rate > 1 m/s) → **departure**

**adsb.lol:**
- Descending (baro rate < -200 ft/min) or on ground → **arrival**
- Ascending (baro rate > 200 ft/min) → **departure**

### API Usage Estimate

- AeroDataBox: 2 calls per poll × 4 polls/hour × 24 hours = **~192 calls/day**
- OpenSky: 2 calls per poll (authenticated, no strict rate limit)
- adsb.lol: 0–2 calls per poll (only when OpenSky returns nothing, no rate limit)

---

## Data Storage

### Database Table

Flight records are stored in SQLite (`jamaica.db`) in the `flights` table:

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-increment primary key |
| `flight_number` | TEXT | Airline flight code (e.g. AA 1986) |
| `airport` | TEXT | Jamaica airport IATA code (KIN, MBJ, OCJ, KTP) |
| `status` | TEXT | Flight status (Arrived, Expected, Departed, Approaching, etc.) |
| `direction` | TEXT | `arrival` or `departure` |
| `airline` | TEXT | Airline name |
| `aircraft` | TEXT | Aircraft model |
| `aircraft_reg` | TEXT | Aircraft registration |
| `route` | TEXT | Origin city (arrivals) or destination city (departures) |
| `route_iata` | TEXT | Origin/destination IATA code |
| `route_country` | TEXT | Origin/destination country code |
| `scheduled_time` | TEXT | Scheduled time (AeroDataBox) or empty (OpenSky) |
| `callsign` | TEXT | ATC callsign |
| `fetched_at` | TEXT | Timestamp when the record was stored |

### Indexes
- `idx_flights_airport` — on `airport`
- `idx_flights_direction` — on `direction`
- `idx_flights_fetched` — on `fetched_at`

### Storage Behavior
- Every poll cycle appends new records (historical accumulation)
- Only flights with `type = 'arrival'` or `type = 'departure'` are stored (live position-only data is excluded)

---

## API Endpoints

### `GET /api/flights`

Returns the cached flight data from the most recent poll. Never triggers an external API call.

**Response:**
```json
{
  "flights": [...],
  "source": "aerodatabox" | "opensky" | "mixed" | "loading",
  "time": 1710000000,
  "airports": [
    { "icao": "MKJP", "iata": "KIN", "name": "Norman Manley Intl", "lat": 17.9356, "lon": -76.7875 },
    ...
  ]
}
```

- `source: "aerodatabox"` — All data from AeroDataBox
- `source: "mixed"` — AeroDataBox for KIN/MBJ + OpenSky for OCJ/KTP
- `source: "opensky"` — AeroDataBox unavailable, OpenSky fallback used
- `source: "loading"` — First fetch hasn't completed yet

### `GET /api/flights/history`

Queries stored flight records from the database.

**Query parameters:**
- `airport` — Filter by IATA code (e.g. `?airport=MBJ`)
- `direction` — Filter by `arrival` or `departure`
- `limit` — Max records to return (default: 100)

**Example:** `/api/flights/history?airport=KIN&direction=arrival&limit=50`

---

## Frontend Display

### Map Markers (FlightTracker component)

When "Live Flights" is toggled on:
- **AeroDataBox airports (KIN, MBJ):** Flight count badges appear at airport positions showing arrival/departure counts (e.g. `↓13 ↑12`)
- **OpenSky live aircraft:** Plane icons at actual aircraft positions, rotated to match heading
- Clicking a flight count badge opens the airport's detail view in the InfoSection panel

### InfoSection — Airport Detail

When an airport is selected (by clicking the map marker or from the parish Items dropdown):
- Airport image, name, IATA/ICAO codes
- Info grid: runway, serves, named after, opened, elevation, operator, website
- Get Directions with location input (appends ", Jamaica" automatically)
- Historical facts
- **Flight Board** with Arrivals and Departures tabs — always displayed, shows "No arrivals at this time" when empty

### Parish Items Dropdown

Parishes containing airports (Kingston, St. James, St. Mary) include an **Airport** category in the Items dropdown. Selecting it lists the airports, and clicking one opens the full Airport Detail view.

---

## File Reference

| File | Purpose |
|------|---------|
| `server/routes/flights.js` | API routes, data fetching, polling, OAuth, DB storage |
| `server/db/schema.sql` | Database schema including `flights` table |
| `server/.env` | API credentials (gitignored) |
| `client/src/components/FlightTracker.jsx` | Map markers for flight counts and live aircraft |
| `client/src/components/AirportDetail.jsx` | Airport info panel with flight board |
| `client/src/components/InfoSection.jsx` | Side panel that hosts AirportDetail |
| `client/src/hooks/useParish.js` | Injects airports as place-like items in parish data |
| `client/src/api/parishes.js` | `fetchFlights()` API call |
