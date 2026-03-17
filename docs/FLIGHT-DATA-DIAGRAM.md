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

    subgraph FlightCache["In-memory flight cache"]
      FlightCacheStore["cached snapshot<br/>scheduled + live state<br/>TTL / refresh interval"]
    end

    subgraph FlightJobs["Background refresh"]
      RefreshFlights["refreshFlights()<br/>periodic task"]
    end
  end

  %% External providers
  subgraph FlightProviders["External Flight Providers"]
    Sched["AeroDataBox / schedule API<br/>(arrivals / departures)"]
    Radar["OpenSky, adsb.lol<br/>live radar / positions"]
  end

  %% Frontend calls backend
  Map -->|"needs live flights layer"| FlightsApiClient
  AirportViews -->|"needs flight board"| FlightsApiClient
  FlightsApiClient -->|"GET /api/flights"| FlightsEndpoint

  %% Endpoint uses cache
  FlightsEndpoint -->|"read snapshot"| FlightCacheStore
  FlightsEndpoint --> FlightsRoute

  %% Background refresh populates cache
  RefreshFlights --> FlightsRoute
  FlightsRoute -->|"fetch scheduled flights"| Sched
  FlightsRoute -->|"fetch live positions"| Radar
  FlightsRoute -->|"merge + normalize<br/>(by flight/icao callsign)"| FlightCacheStore

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

