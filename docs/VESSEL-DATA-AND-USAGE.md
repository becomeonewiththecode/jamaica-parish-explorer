# Vessel Traffic Data — Collection, Use, and Display

This document describes how vessel (ship / boat / cruise) data is collected from AIS, cached, and displayed in the Jamaica Parish Explorer.

---

## Data Sources

### AISStream.io (AIS vessel positions)

- **Provider:** [AISStream.io](https://aisstream.io/) (free, API key required)
- **Protocol:** Secure WebSocket (`wss`)
- **Endpoint:** `wss://stream.aisstream.io/v0/stream`
- **Authentication:** API key via JSON subscription message (`AISSTREAM_API_KEY` in `server/.env`)
- **Filter:** A geographic **bounding box around Jamaica** so only nearby vessels are streamed:

  ```json
  [
    [-79.5, 17.2],
    [-75.5, 19.2]
  ]
  ```

- **Message type used:** `PositionReport` (AIS position messages)
  - Core fields: `UserID` (MMSI), `Latitude`, `Longitude`, `TrueHeading`, `Sog` (speed over ground, knots), `Cog` (course over ground).
  - Optional static data when available: `ShipName`, `ShipType`.

AISStream.io sends a continuous stream of AIS messages for vessels that are broadcasting within the bounding box. The app does **not** store raw AIS messages; it keeps only a compact, derived representation suitable for the map.

### CruiseDig / CruiseMapper (cruise schedules per port)

- **Providers:**
  - [CruiseDig](https://www.cruisedig.com/) — Montego Bay and Ocho Rios cruise schedules.
  - [CruiseMapper](https://www.cruisemapper.com/) — Falmouth cruise schedules.
- **Module:** `server/routes/port-cruises.js`
- **Endpoint:** `GET /api/ports/:id/cruises`
- **Ports covered:**
  - `montego-bay-cruise-port` → `https://cruisedig.com/ports/montego-bay-jamaica`
  - `ocho-rios-cruise-port` → `https://cruisedig.com/ports/ocho-rios-jamaica`
  - `falmouth-cruise-port` → `https://www.cruisemapper.com/ports/falmouth-port-4261`
- **Frequency / cache:**
  - HTML is fetched from the source site only when the cache is **stale**.
  - Results are cached in-memory per port with a TTL of **6 hours** (`CACHE_TTL_MS`).
  - If a refresh fails, the app keeps serving the last successful schedule from cache when available.

---

## Server-Side Collection and API

### Environment and configuration

- **Env var:** `AISSTREAM_API_KEY` in `server/.env`
- **Module:** `server/routes/vessels.js`
- **Mount path:** `app.use('/api/vessels', vesselRoutes);` in `server/index.js`

If `AISSTREAM_API_KEY` is not set, the vessels route is available but returns an empty list and logs a warning; no WebSocket connection is opened.

- **Optional env var:** `TRACKED_SHIP_MMSIS` — comma-separated list of MMSI numbers (e.g. `311263000` for Adventure of the Seas). When set, the server opens a second AISStream connection subscribed to a **global bounding box** with `FiltersShipMMSI` set to these MMSIs. Positions for these vessels are then available from `/api/vessels` wherever the ship is, so you can locate them before they enter the Jamaica box.

### WebSocket subscription

On first request to `/api/vessels`, the server ensures a single shared WebSocket is connected:

1. Connects to `wss://stream.aisstream.io/v0/stream` using `ws`.
2. Sends a subscription message:

   ```json
   {
     "APIkey": "AISSTREAM_API_KEY",
     "BoundingBoxes": [
       [
         [-79.5, 17.2],
         [-75.5, 19.2]
       ]
     ]
   }
   ```

3. Listens for JSON messages and processes only `MessageType === "PositionReport"`.
4. On error/close, automatically retries the connection after a short delay.

### In-memory vessel cache

`vesselsCache` is an array of normalized vessel entries, derived from `PositionReport` messages:

```js
{
  mmsi: string,       // AIS "UserID"
  name: string,       // ShipName when available, else ''
  shipType: string,   // ShipType when available
  lat: number,
  lon: number,
  heading: number,    // TrueHeading (degrees)
  sog: number,        // speed over ground (knots)
  cog: number,        // course over ground (degrees)
  lastSeen: number    // ms since epoch
}
```

- **Upsert logic:**
  - When a `PositionReport` arrives:
    - If an entry for this `mmsi` exists, update its position and metadata.
    - Otherwise, create a new entry.
- **Time-to-live:**
  - Only vessels seen in the last **30 minutes** are kept.
  - A cleanup runs every 5 minutes; older entries are discarded.

No vessel data is persisted to disk; it is purely in-memory and rebuilt from the AIS stream after a server restart.

### REST endpoint: `GET /api/vessels`

**Path:** `/api/vessels`  
**Method:** `GET`  
**Query params:**

- `type` (optional):
  - `all` (default): return all known vessels.
  - `cruise`: return only likely cruise/passenger vessels using a simple heuristic.

**Heuristic for `type=cruise`:**

- Includes vessels where:
  - `shipType` contains "passenger", OR
  - `name` (case-insensitive) contains `carnival`, `royal`, `msc`, `norwegian`, or `cruise`.

**Response shape:**

```json
{
  "vessels": [
    {
      "mmsi": "123456789",
      "name": "CARNIVAL EXAMPLE",
      "shipType": "Passenger",
      "lat": 18.01,
      "lon": -76.8,
      "heading": 135,
      "sog": 12.3,
      "cog": 140,
      "lastSeen": 1773633545000
    }
  ],
  "time": 1773633545,
  "bbox": {
    "lonMin": -79.5,
    "latMin": 17.2,
    "lonMax": -75.5,
    "latMax": 19.2
  }
}
```

**Notes:**

- `time` is a UNIX timestamp (seconds) when the snapshot was generated.
- `bbox` echoes the Jamaica bounding box the server is subscribed to.

---

## Client Usage

### API helper

- **File:** `client/src/api/vessels.js`
- **Function:**

  ```js
  import { fetchWithRetry } from './fetchWithRetry';

  export async function fetchVessels(type = 'all') {
    const params = new URLSearchParams();
    if (type && type !== 'all') params.set('type', type);
    const query = params.toString();
    const url = `/api/vessels${query ? `?${query}` : ''}`;
    return fetchWithRetry(url);
  }
  ```

The client always receives the server snapshot and lets the map decide how to render or filter it further.

### Map layer and toggle

- **Component:** `client/src/components/MapSection.jsx`

#### State

- `showVessels` — whether the vessel layer is visible.
- `vessels` — latest API snapshot from `/api/vessels`.

#### Top bar toggle

Vessels are controlled by the 🛳 **Vessels** switch inside the **✈ Live Data** dropdown (also affected by the **✈ Live Data (All)** master switch):

- **States:**
  - `OFF` — no vessel markers drawn; polling stopped.
  - `ON` — vessel markers drawn on the map; polling active.

On initial load:
- **Vessels start ON**
- **Flights start OFF**, so you may see weather/waves/vessel markers even though the flight overlay is not shown yet.

Tooltip:
- Use the app's Live Data button tooltip to infer whether all live overlays are shown/hidden.

#### Polling behavior

When `showVessels` is `true` and no Thunderforest base layer is hiding items:

- The client calls `fetchVessels('all')` immediately.
- Then repeats every **60 seconds** while the toggle is ON.
- If the toggle is turned OFF (or a Thunderforest base layer hides items), the polling is stopped and `vessels` is cleared.

### Map rendering

- **Icon:** `vesselIcon` (Leaflet `divIcon`)
  - Small circular badge with:
    - Dark navy background
    - Light blue border and glow
    - Centered ship emoji (`🛳`)
- **Markers:**

  ```jsx
  <Marker
    key={v.mmsi}
    position={[v.lat, v.lon]}
    icon={vesselIcon}
    rotationAngle={v.heading || v.cog || 0}
    rotationOrigin="center"
  >
    <Tooltip direction="top" offset={[0, -14]} className="place-leaflet-tooltip">
      <strong>{v.name || `MMSI ${v.mmsi}`}</strong><br />
      <span style={{ fontSize: '0.75rem', color: '#7a9cc6' }}>
        {v.shipType || 'Vessel'} · {v.sog != null ? `${v.sog.toFixed(1)} kn` : '—'}
      </span>
    </Tooltip>
  </Marker>
  ```

- **Zoom levels:** Vessel markers are drawn at all map zooms; they are easiest to see around zoom 9–12.

### Port markers and status badges

- **Port icons:**
  - For major cruise ports and marinas (Historic Falmouth, Montego Bay, Ocho Rios, Errol Flynn Marina, Kingston Harbour) the map shows a circular ⚓ icon:
    - Dark navy background, gold border and glow.
    - Tooltip: port name, city, and whether it is a cruise pier or cruise+cargo port.
  - These icons are only visible when the **Vessels** layer is ON.

- **Port status badges (map, above the port icon):**
  - A small rounded pill rendered as a Leaflet `divIcon` via `buildPortStatusIcon(expectedCount, inPortCount)`.
  - Layout:
    - Left segment: `🛬 X` where X is the number of **upcoming cruise calls** for that port, scraped from CruiseDig / CruiseMapper via `/api/ports/:id/cruises`.
    - Right segment: `🛥 Y` where Y is the number of **AIS vessels currently near the port**, computed from the `/api/vessels` snapshot within ~3 km of the pier.
  - Styling:
    - Dark navy pill with gold border.
    - Expected segment in light blue, in‑port segment in teal, with a grey separator.
  - Visibility:
    - Only shown when **Vessels** is ON.
    - Hidden when both counts are zero (no upcoming calls and no vessels in port).
    - Tooltip shows the port name and both counts: “Expected: X · In port (AIS): Y”.

- **Dock verification (schedule vs AIS):**
  - A vessel is considered **docked** at a port if its AIS position is within **3 km** of that port's coordinates (computed client-side from `/api/vessels` and port lat/lon).
  - The port popup compares **upcoming cruise calls** (from CruiseDig / CruiseMapper) with **ships currently in port (AIS)** by matching ship names: normalized (lowercase, collapsed spaces), with a "contains" check so minor naming differences (e.g. "Adventure of the Sea" vs "Adventure of the Seas") still match.
  - Each upcoming call gets an AIS status: **In port** if a matching vessel is within 3 km, **—** otherwise. If a call has ETA **today** and no matching docked vessel, a warning is displayed so users can see when an expected ship is not yet reporting in port.

- **Port detail popup:**
  - Clicking a port icon opens `PortPopup` (reusing the airport popup layout) and shows:
    - Port name, city, and type badge.
    - Two badges mirroring the status pill: `🛬 Expected X` and `🛥 In port Y`.
    - An **“Upcoming cruise calls”** section listing upcoming cruises (current month, future ETAs) with ship name, operator (when available), ETA text, and an **AIS** column:
      - **“In port”** — a vessel in the AIS “ships currently in port” list matches this scheduled ship by name (normalized, case-insensitive; handles minor variants like “Adventure of the Sea” vs “Adventure of the Seas”), so the ship is considered **docked** (within 3 km of the port).
      - **“—”** — no matching AIS vessel; the ship does **not** report as docked.
    - If any ship with an ETA **today** does not match a docked vessel, a warning is shown: *“N ship(s) expected today not yet reporting in port (AIS): Ship1, Ship2.”*
    - A **“Ships currently in port (AIS)”** section listing vessels within 3 km of the port (name, type, speed).
    - A directions button linking to Google Maps for the port coordinates.

### Interaction with other layers

- **Base maps:**
  - Standard OSM base map or any Thunderforest base (Transport, Landscape, Neighbourhood) can be used with vessels.
  - Thunderforest base layers still hide POI markers and parishes as designed, but vessels can be combined with them visually.

- **Other overlays when Vessels ON:**
  - **Visible together with vessels:**
    - Live flights
    - Weather layer (parish weather icons)
    - Wave layer (coastal wave markers)
    - Parish boundaries and airports
  - **Hidden when vessels are ON (to reduce clutter):**
    - Always‑on POI markers (hotels, beaches, etc.)
    - Parish-specific POI markers and search highlight
    - Category filter bar and category legend

This keeps the map readable when viewing ships, while still allowing users to overlay **flights, weather, and waves** on the same view for combined situational awareness.

---

## Operational Notes

- If `/api/vessels` returns `vessels: []`, AISStream is connected but no AIS `PositionReport` messages are currently within the Jamaica bounding box (or the stream is temporarily quiet).
- Keeping the app open with **Vessels ON** will automatically update markers as ships enter or leave the area or start/stop transmitting AIS (client polls `/api/vessels` every 60 seconds).
- AIS messages are still held in-memory for map rendering, but cruise schedules scraped from CruiseDig / CruiseMapper are now also **persisted** to PostgreSQL (`cruise_ports` and `cruise_calls` tables) when `/api/ports/:id/cruises` is requested. This allows future features (reports, history, AIS‑linked arrival tracking) to reuse the same stored cruise schedule data.

