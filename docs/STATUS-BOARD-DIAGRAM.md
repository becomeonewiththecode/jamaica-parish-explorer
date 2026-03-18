## Status Board Architecture Diagram

The diagram below shows how the status board queries internal services and derives all external provider health from the main API's `/api/health` endpoint — it makes **no direct calls** to external weather or flight APIs.

```mermaid
flowchart LR
  subgraph Client["Browser (Status Board UI)"]
    SB["Status Board HTML/JS<br/>(http://localhost:5555)"]
  end

  subgraph StatusServer["Status Board Server<br/>server/status-board.js"]
    ST["GET /status.json"]
  end

  subgraph ApiServer["Main API Server<br/>server/index.js"]
    H["GET /api/health<br/>{ ok, uptime, providers, flightProviders }"]
    WIsland["GET /api/weather/island"]
    WWaves["GET /api/weather/waves"]
    FApi["GET /api/flights"]
    VApi["GET /api/vessels"]
    WRoutes["Weather routes<br/>server/routes/weather.js"]
    FRoutes["Flight routes<br/>server/routes/flights.js"]
  end

  subgraph ExternalWeather["External Weather Providers<br/>(called only by API)"]
    OM["Open-Meteo<br/>/v1/forecast"]
    WA["WeatherAPI<br/>/current.json"]
    OW["OpenWeatherMap<br/>/data/2.5/weather"]
    Marine["Open-Meteo Marine<br/>/v1/marine"]
  end

  subgraph ExternalFlights["External Flight Providers<br/>(called only by API)"]
    ADB["AeroDataBox / RapidAPI"]
    OS["OpenSky Network"]
    ADSB["adsb.lol"]
  end

  %% Browser talks only to status board
  SB -->|"auto-refresh"| ST

  %% Status board internal checks (API endpoints)
  ST -->|"internal checks"| WIsland
  ST -->|"internal checks"| WWaves
  ST -->|"internal checks"| FApi
  ST -->|"internal checks"| VApi

  %% Health endpoint provides weather + flight provider status
  ST -->|"GET /api/health"| H
  H -->|"providers (weather)"| ST
  H -->|"flightProviders (flights)"| ST

  %% Weather routes call external providers and maintain providerHealth
  WRoutes -->|"fetchAllProvidersCurrent"| OM
  WRoutes -->|"fallback / aggregate"| WA
  WRoutes -->|"fallback / aggregate"| OW
  WWaves --> Marine

  %% Flight routes call external providers and maintain flightProviderHealth
  FRoutes -->|"scheduled flights"| ADB
  FRoutes -->|"live radar (secondary)"| OS
  FRoutes -->|"live radar (primary)"| ADSB

  %% Legend
  classDef internal fill:#0b1020,stroke:#1f2937,color:#f9fafb;
  classDef external fill:#111827,stroke:#4b5563,color:#e5e7eb;

  class StatusServer,ApiServer internal;
  class ExternalWeather,ExternalFlights external;
```

