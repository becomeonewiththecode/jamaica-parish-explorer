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
- **Rate limits:** BASIC plan allows 1 request/second. Requests are sent sequentially with a 1.1-second delay between airports. If the API returns **HTTP 429** (Too Many Requests) for an airport, the server retries that airport once after 3.5 seconds. Scheduled data is cached **per airport** (KIN, MBJ): if one airport’s fetch fails or returns 429 after retry, the last successful data for that airport is kept so the arrival/departure board is not shown empty.
- **API endpoint:** `https://aerodatabox.p.rapidapi.com/flights/airports/icao/{ICAO}`

### OpenSky Network (Secondary — Live Radar)
- **Provider:** OpenSky Network
- **Airports covered:** Ian Fleming Intl (OCJ) and Tinson Pen (KTP)
- **Data type:** Live ADS-B radar positions of aircraft within a ~25 km bounding box of each airport
- **Authentication:** OAuth2 client credentials flow (Keycloak). Token is cached for 30 minutes and refreshed automatically
- **Token endpoint:** `https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token`
- **API endpoint:** `https://opensky-network.org/api/states/all?lamin=...&lamax=...&lomin=...&lomax=...`
- **Fallback role:** If AeroDataBox fails entirely, OpenSky is also used as a Jamaica-wide fallback (bounding box covering the full island)
- **Rate limiting / 429 handling:**
  - For **flight data** (in `server/routes/flights.js`), OpenSky is treated as a **secondary source** behind adsb.lol, and all calls include the bearer token. If OpenSky returns **HTTP 429**, the flights code simply treats the response as empty and continues using adsb.lol, so the UI stays live even when OpenSky is temporarily unavailable. The health state is tracked internally via `updateFlightProviderHealth()`.
  - The **status board** does **not** call OpenSky directly. It derives OpenSky’s status from the main API’s `/api/health` endpoint (`flightProviders.opensky`), avoiding extra calls that would burn through the rate limit.
- **Note:** Caribbean ADS-B receiver coverage is sparse — OpenSky may return zero aircraft even when flights are active; adsb.lol is used as the primary live radar source.

### adsb.lol (Tertiary — Live Radar, Free)
- **Provider:** adsb.lol (open ADS-B data aggregator)
- **Airports covered:** Ian Fleming Intl (OCJ) and Tinson Pen (KTP) — used as fallback when OpenSky returns no data; also used for all Jamaica airports (KIN, MBJ, OCJ, KTP) and Jamaica-wide
- **Data type:** Live ADS-B transponder data within a 25 nautical mile radius of each airport; Jamaica-wide within 165 nm of island center
- **Authentication:** None required (free, no API key)
- **API endpoints:**  
  - `https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{radius_nm}` — aircraft near a point  
  - `https://api.adsb.lol/api/0/routeset` (POST) — batch route lookup by callsign/lat/lng; returns `airport_codes_icao` or `airport_codes` (ICAO preferred for Jamaica matching)
- **Data includes:** Callsign, aircraft type, registration, operator, lat/lon, altitude, ground speed, heading, barometric rate
- **Advantage:** Aggregates data from multiple ADS-B feeder networks, providing better Caribbean coverage than OpenSky alone

### Airport Coverage Summary

| Airport | IATA | ICAO | Data Source | Data Type |
|---------|------|------|-------------|-----------|
| Norman Manley International | KIN | MKJP | AeroDataBox + live radar | Scheduled + live (reclassified) |
| Sangster International | MBJ | MKJS | AeroDataBox + live radar | Scheduled + live (reclassified) |
| Ian Fleming International | OCJ | MKBS | OpenSky → adsb.lol | Live radar |
| Tinson Pen Aerodrome | KTP | MKTP | OpenSky → adsb.lol | Live radar |

KIN and MBJ show both **Scheduled** (AeroDataBox) and **Live Radar** (adsb.lol/OpenSky, reclassified by route) on the flight board; status for scheduled flights is updated using live radar (see “Scheduled flight status confirmation” below).

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

- **Scheduled flights (AeroDataBox):** Polled every **15 minutes** for KIN and MBJ.
- **Live radar (adsb.lol, OpenSky):** Polled every **30 seconds** for all Jamaica airports (per-airport radius plus Jamaica-wide).
- **Startup behaviour:** On server boot, the server checks for a persisted cache file (`server/.flight-cache.json`). If fresh scheduled flight data exists (less than 15 minutes old), it is restored into memory and the startup AeroDataBox fetch is **skipped** to avoid unnecessary paid API calls. Route cache entries still within their 2-hour TTL are also restored. If the cache is stale or missing, the first fetch runs immediately as before.

### Fetch Sequence (per poll cycle)

**Scheduled (every 15 min):**
1. **AeroDataBox** — Query KIN and MBJ sequentially (1.1s delay between requests to respect rate limit).
2. **OpenSky fallback** — If AeroDataBox returns zero flights, query OpenSky for all Jamaica airspace.

**Live radar (every 30 s):**
1. For **each Jamaica airport** (KIN, MBJ, OCJ, KTP): try **adsb.lol** (25 nm radius), then **OpenSky** if needed.
2. **Jamaica-wide** adsb.lol and OpenSky queries to capture aircraft near the island but outside any single airport radius (e.g. approaching flights that are later reclassified to arrival at MBJ or KIN).
3. Fetched live flights are deduplicated, filtered by distance (e.g. within 165 nm of Jamaica), enriched with route data (adsb.lol routeset, OpenSky, hexdb), then merged with the cached scheduled flights. The combined list is what `GET /api/flights` returns.

**Cache cleanup (every 2 min):**  
A scheduled job removes **live** landed arrivals and departed departures from the cache once they are more than **45 minutes** past their completed time (from radar). **Scheduled** (AeroDataBox) flights are never removed by the server — they often have past scheduled times and would otherwise be wiped; the client hides completed scheduled flights after 45 minutes.

**Cache persistence:** After each scheduled fetch and every 5 minutes for route data, the server writes both the per-airport scheduled flights and the route lookup cache to `server/.flight-cache.json`. This file is restored on startup so server restarts within the poll interval do not trigger redundant AeroDataBox (paid) or route lookup API calls.

**Provider health on restart:** When the scheduled flight cache is restored from disk, the AeroDataBox and RapidAPI provider health snapshots are pre-populated with `lastOk: true` and the timestamp of the cached data. This ensures the status board shows these providers as online immediately after a restart, rather than "not checked yet" until the next scheduled poll (up to 15 minutes).

**Key intervals (in code):**
- Scheduled poll: 15 min. Live radar poll: 30 s. Cleanup: every 2 min. Cache persist: every 5 min (routes).
- Completed flights hidden after **45 min** (client and server cleanup for live only).
- No radar contact: scheduled flight marked Landed/Departed **15 min** after scheduled time.

### Live Radar Flight Classification

Since OpenSky and adsb.lol provide raw aircraft positions (not schedule data), flights are initially classified by vertical rate and distance. **Route enrichment** then reclassifies flyovers to arrivals or departures when the route shows a Jamaica airport as destination or origin.

**Initial classification (single source of truth):**  
All live flights (OpenSky and adsb.lol) use a shared **classifyLiveFlight()** so that direction and status are derived the same way from **position, distance to airport, and altitude**. It accepts vertical rate in m/s (OpenSky) or baro rate in ft/min (adsb.lol), so the same rules apply to both sources and the flight board and map stay in sync:
- **On ground** → arrival, status “On Ground”
- **Descending** (vertical rate or baro rate) and (altitude ≤ 20,000 ft, or high but within 40 nm) → arrival, “Approaching”
- **Climbing** and altitude ≤ 15,000 ft → departure, “Departing”
- **Low and close** (≤ 10,000 ft, ≤ 15 nm) → arrival, “Approaching”
- Otherwise → flyover, “Flyover”

**Route enrichment and reclassification (KIN, MBJ, OCJ, KTP):**
- Routes are resolved via **adsb.lol routeset** (preferred), then OpenSky, then hexdb.io. The server prefers `airport_codes_icao` from the routeset when present so Jamaica is matched by ICAO (e.g. MKJS).
- If the **destination** is a Jamaica airport (by ICAO or IATA, e.g. MKJS or MBJ) and the flight was classified as a flyover, it is **reclassified to arrival** and assigned that airport (e.g. Sangster/MBJ). That way approaching flights (e.g. SWA272) appear on the correct airport’s arrival board even before they enter the per-airport radius.
- If the **origin** is a Jamaica airport and the flight was a flyover, it is **reclassified to departure**.
- So live arrivals/departures at KIN and MBJ come from both AeroDataBox (scheduled) and live radar (reclassified), and the flight board shows both “Scheduled” and “Live Radar” sections.

### Scheduled flight status confirmation (KIN / MBJ)

Scheduled flights (AeroDataBox) are cross-referenced with live radar so the board shows **En Route**, **Landed**, or **Departed** instead of staying on **Expected**:

1. **Callsign matching:** Scheduled flight numbers (e.g. DL1997) are matched to live callsigns (e.g. DAL1997) using equivalent designators (DL↔DAL, UA↔UAL, AA↔AAL, WN↔SWA, etc.). So when the radar reports Delta DAL1997 “On Ground”, the scheduled DL1997 is updated.
2. **Radar “On Ground”:** If a live flight with a matching callsign has status “On Ground”, the scheduled flight is shown as **Landed** (arrival) or **Departed** (departure).
3. **Persisted “Landed”:** When a flight is seen “On Ground”, that state is remembered under all callsign variants. If the aircraft later drops off the live feed (e.g. no longer in the polled area), the scheduled flight still shows **Landed** / **Departed** instead of reverting to Expected.
4. **No radar contact:** If there is no live match and the scheduled time is more than **15 minutes** in the past, the flight is marked **Landed** / **Departed** (assumed completed) so “Expected” does not persist indefinitely.
5. **Completed flights** are hidden 45 minutes after the completed time. The client hides them in the UI. The server **scheduled cleanup** (every 2 minutes) removes only **live** landed arrivals and departed departures from the cache once they are past that 45-minute window; **scheduled** flights are never removed by the server (the client hides completed scheduled flights after 45 minutes).

### API Usage Estimate

- AeroDataBox: 2 calls per poll × 4 polls/hour × 24 hours = **~192 calls/day**
- OpenSky: 2 calls per poll (authenticated, secondary — used when adsb.lol returns nothing)
- adsb.lol: up to 6 calls per poll (4 per-airport + 1 Jamaica-wide, no rate limit)

> **Note:** The status board does **not** make any direct calls to AeroDataBox, OpenSky, or adsb.lol. All flight provider status is derived from the main API's `/api/health` endpoint.

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
- **Live aircraft:** Plane icons at actual aircraft positions, rotated to match heading. **Icons** match the typecode category: helicopter, cargo, business, small, widebody, and narrow each have a distinct inline SVG shape; **color** is from altitude (see altitude legend at bottom of map).
- Clicking a flight count badge opens the airport's detail view in the InfoSection panel

**Aircraft type designators (typecode → icon):**  
Map icons use a single typecode per flight (from live data `typecode`/`aircraft` or normalized from model names). The mapping from typecode to icon category (helicopter, cargo, business, small, widebody, narrow) is defined in `client/src/data/aircraftTypeDesignators.js` and aligns with:

- **ICAO** type codes (e.g. from ADS-B: `B738`, `A320`, `GLF6`)
- **Transport Canada Standard 421.40** — [Aircraft Type Designators for Individual Type Ratings (TCCA)](https://tc.canada.ca/en/aviation/licensing-pilots-personnel/flight-crew-licences-permits-ratings/aircraft-type-designation/standard-42140-aircraft-type-designators-individual-type-ratings-transport-canada-tcca) (effective April 1, 2026)

So both ICAO (e.g. `B73C`, `GLF6`) and TCCA designators (e.g. `B73C`, `GLF6`, `EA32`, `HS25`) are recognized. Each category (helicopter, cargo, business, small, widebody, narrow) has a distinct plane icon on the map; typecode is taken from live data (e.g. adsb.lol `t` field) or normalized from `aircraft` when present.

### InfoSection — Airport Detail

When an airport is selected (by clicking the map marker or from the parish Items dropdown), the panel content depends on the **Live Flights** toggle:

- **Live Flights ON (flight data icon):** **Flight-only view** — airport name and code, **Jamaica time** (live, America/Jamaica), **weather at the airport** (temp, description, wind), and the Flight Board (Arrivals/Departures). No image, runway, directions, or historical facts.
- **Live Flights OFF (airport icon):** **Full airport detail** — airport image, name, IATA/ICAO, info grid (runway, serves, named after, opened, elevation, operator, website), Get Directions, historical facts, and the Flight Board.

In both cases the Flight Board is shown; it has Arrivals and Departures tabs and shows "No arrivals at this time" when empty.

**Client API:** `fetchFlights()` and other client requests use `fetchWithRetry` (see `client/src/api/fetchWithRetry.js`): failed fetches are retried up to 3 times with exponential backoff (1s, 2s, 4s, cap 10s).

### Parish Items Dropdown

Parishes containing airports (Kingston, St. James, St. Mary) include an **Airport** category in the Items dropdown. Selecting it lists the airports, and clicking one opens the full Airport Detail view.

---

## File Reference

| File | Purpose |
|------|---------|
| `server/routes/flights.js` | API routes, data fetching, polling, OAuth, DB storage, disk-persistence; contains `classifyLiveFlight()`, `getCallsignMatchKeys()`, `confirmFlightStatuses()`, `removeCompletedFlightsFromCache()` |
| `server/.flight-cache.json` | Auto-generated persisted cache (scheduled flights + route lookups); restored on startup to avoid redundant API calls. Git-ignored |
| `server/db/schema.sql` | Database schema including `flights` table |
| `server/.env` | API credentials (gitignored) |
| `client/src/data/aircraftTypeDesignators.js` | Typecode → icon category (ICAO + TCCA Standard 421.40) |
| `client/src/components/FlightTracker.jsx` | Map markers for flight counts and live aircraft |
| `client/src/components/AirportDetail.jsx` | Airport info panel with flight board |
| `client/src/components/InfoSection.jsx` | Side panel that hosts AirportDetail |
| `client/src/hooks/useParish.js` | Injects airports as place-like items in parish data |
| `client/src/api/parishes.js` | `fetchFlights()` and other parish/places API calls (via fetchWithRetry) |
| `client/src/api/fetchWithRetry.js` | Fetch wrapper: retries on failure (3 retries, exponential backoff) |
