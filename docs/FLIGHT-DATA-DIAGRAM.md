## Flight Data Flow Diagram

The diagram below shows how scheduled and live flight data is collected from external providers, cached in the backend, and used in the frontend map and airport views.

```mermaid
flowchart LR
  %% Frontend
  subgraph Frontend["React Frontend (client)"]
    Map["Map components<br/>(MapSection, Airport overlays)"]
    AirportViews["Airport detail views<br/>(flight boards)"]
    FlightsApiClient["client/src/api/parishes.js<br/>(flights helpers)"]
  end

  %% Backend
  subgraph Backend["Express API (server)"]
    FlightsRoute["Flights route<br/>server/routes/flights.js"]
    FlightsEndpoint["GET /api/flights"]

    subgraph FlightCache["In-memory flight caches"]
      ScheduledCache["cachedScheduledByAirport<br/>per-airport scheduled flights<br/>poll: 15 min"]
      LiveCache["flightsCache<br/>merged scheduled + live<br/>poll: 30 sec"]
      RouteCache["routeCache (Map)<br/>callsign → origin/dest ICAO<br/>TTL: 2 hours"]
    end

    DiskCache[("server/.flight-cache.json<br/>(disk persistence)")]

    subgraph FlightJobs["Background polling"]
      ScheduledPoll["fetchScheduledFlights()<br/>every 15 min<br/>skipped on startup if cache fresh"]
      LivePoll["fetchLiveRadar()<br/>every 30 sec"]
    end
  end

  %% External providers
  subgraph FlightProviders["External Flight Providers"]
    Sched["AeroDataBox / schedule API<br/>(arrivals / departures)"]
    Radar["OpenSky, adsb.lol<br/>live radar / positions"]
  end

  %% Frontend calls backend
  Map -->|"needs ✈ Flights switch in Live Data dropdown (default OFF)"| FlightsApiClient
  AirportViews -->|"needs flight board"| FlightsApiClient
  FlightsApiClient -->|"GET /api/flights"| FlightsEndpoint

  %% Endpoint uses cache
  FlightsEndpoint -->|"read snapshot"| LiveCache
  FlightsEndpoint --> FlightsRoute

  %% Scheduled poll fetches from AeroDataBox (paid API)
  ScheduledPoll --> FlightsRoute
  FlightsRoute -->|"fetch scheduled flights<br/>(KIN, MBJ — 1.1s delay)"| Sched
  FlightsRoute -->|"update per-airport cache"| ScheduledCache

  %% Live poll fetches from free radar APIs
  LivePoll --> FlightsRoute
  FlightsRoute -->|"fetch live positions<br/>(per-airport + Jamaica-wide)"| Radar
  FlightsRoute -->|"enrich via route lookup<br/>(adsb.lol routeset, OpenSky, hexdb)"| RouteCache
  FlightsRoute -->|"merge scheduled + live"| LiveCache

  %% Disk persistence: scheduled + routes written after each scheduled fetch and every 5 min
  ScheduledPoll -->|"persistFlightCache()"| DiskCache
  DiskCache -->|"restore on startup<br/>if scheduled &lt; 15 min old"| ScheduledCache
  DiskCache -->|"restore on startup<br/>if route within 2hr TTL"| RouteCache

  %% Data back to frontend
  FlightsEndpoint -->|"JSON list of flights<br/>{ id, callsign, origin, destination, eta, alt, lat, lon, source }"| FlightsApiClient
  FlightsApiClient -->|"map-ready props"| Map
  FlightsApiClient -->|"boards + status text"| AirportViews

  %% Legend
  classDef frontend fill:#0b1020,stroke:#1f2937,color:#f9fafb;
  classDef backend fill:#111827,stroke:#4b5563,color:#e5e7eb;
  classDef external fill:#020617,stroke:#4b5563,color:#e5e7eb;

  class Frontend frontend;
  class Backend backend;
  class FlightProviders external;
```

