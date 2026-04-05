## Status Board Architecture Diagram

The diagram below shows how the status board queries internal services and derives all external provider health from the main API's `/api/health` endpoint — it makes **no direct calls** to external weather or flight APIs. The same **`/api/health`** response also includes **`mapDataRebuild`** (OSM map-data job status, per-category progress); the status board HTML does not render it today, but it is available in the JSON for monitoring tools.

```mermaid
flowchart LR
  subgraph Client["Browser (Status Board UI)"]
    SB["Status Board HTML/JS<br/>(http://localhost:5555)<br/>auto-refresh every 1 min<br/>countdown timer"]
  end

  subgraph StatusServer["Status Board Server<br/>server/status-board.js"]
    ST["GET /status.json"]
    PM2["PM2 process status<br/>(pm2 jlist)"]
  end

  subgraph ApiServer["Main API Server<br/>server/index.js (port 3001)"]
    H["GET /api/health<br/>{ ok, uptime, providers,<br/>waveProviders, flightProviders,<br/>mapDataRebuild }"]
    WIsland["GET /api/weather/island"]
    WWaves["GET /api/weather/waves"]
    FApi["GET /api/flights"]
    VApi["GET /api/vessels"]
    CApi["GET /api/ports/{port}/cruises<br/>(Montego Bay, Ocho Rios, Falmouth)"]
    WRoutes["Weather routes<br/>server/routes/weather.js"]
    FRoutes["Flight routes<br/>server/routes/flights.js"]
    VRoutes["Vessel routes<br/>server/routes/vessels.js"]
  end

  subgraph Servers["Server Checks"]
    API["API server (3001)"]
    Vite["Client / Vite (5173)"]
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

  subgraph ExternalVessels["External Vessel Provider<br/>(called only by API)"]
    AIS["AISStream.io"]
  end

  %% Browser talks only to status board
  SB -->|"auto-refresh<br/>(1 min countdown)"| ST

  %% Status board internal checks (API endpoints)
  ST -->|"internal check"| WIsland
  ST -->|"internal check"| WWaves
  ST -->|"internal check"| FApi
  ST -->|"internal check"| VApi
  ST -->|"internal check<br/>(3 ports)"| CApi

  %% Health endpoint provides weather, wave, flight provider status, + map rebuild snapshot
  ST -->|"GET /api/health"| H
  H -->|"providers (weather)"| ST
  H -->|"waveProviders (waves)"| ST
  H -->|"flightProviders (flights)"| ST
  H -.->|"mapDataRebuild<br/>(optional consumers / JSON)"| ST

  %% Server reachability checks
  ST -->|"TCP check"| API
  ST -->|"TCP check"| Vite

  %% PM2 process status
  ST --> PM2

  %% Weather routes call external providers and maintain providerHealth
  WRoutes -->|"fetchAllProvidersCurrent"| OM
  WRoutes -->|"fallback / aggregate"| WA
  WRoutes -->|"fallback / aggregate"| OW
  WWaves --> Marine

  %% Flight routes call external providers and maintain flightProviderHealth
  FRoutes -->|"scheduled flights"| ADB
  FRoutes -->|"live radar (secondary)"| OS
  FRoutes -->|"live radar (primary)"| ADSB

  %% Vessel routes call external provider
  VRoutes --> AIS

  %% Legend
  classDef internal fill:#0b1020,stroke:#1f2937,color:#f9fafb;
  classDef external fill:#111827,stroke:#4b5563,color:#e5e7eb;

  class StatusServer,ApiServer internal;
  class ExternalWeather,ExternalFlights,ExternalVessels,Servers external;
```
