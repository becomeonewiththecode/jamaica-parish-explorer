## Status Board Architecture Diagram

The diagram below shows how the status board queries internal services and how weather provider health is surfaced without calling external weather APIs directly from the board.

```mermaid
flowchart LR
  subgraph Client["Browser (Status Board UI)"]
    SB["Status Board HTML/JS<br/>(http://localhost:5555)"]
  end

  subgraph StatusServer["Status Board Server<br/>server/status-board.js"]
    ST["GET /status.json"]
  end

  subgraph ApiServer["Main API Server<br/>server/index.js"]
    H["GET /api/health<br/>{ ok, uptime, env, providers }"]
    WIsland["GET /api/weather/island"]
    WWaves["GET /api/weather/waves"]
    WRoutes["Weather routes<br/>server/routes/weather.js"]
  end

  subgraph ExternalWeather["External Weather Providers<br/>(called only by API)"]
    OM["Open-Meteo<br/>/v1/forecast"]
    WA["WeatherAPI<br/>/current.json"]
    OW["OpenWeatherMap<br/>/data/2.5/weather"]
  end

  subgraph OtherExternal["Other External APIs"]
    Marine["Open-Meteo Marine<br/>/v1/marine"]
    Flights["OpenSky, adsb.lol"]
    Vessels["AISStream.io"]
  end

  %% Browser talks only to status board
  SB -->|"auto-refresh"| ST

  %% Status board internal checks
  ST -->|"internal checks"| ApiServer

  %% Health + provider status
  ST -->|"GET /api/health"| H
  H -->|"providers.open-meteo / weatherapi / openweather"| ST

  %% Weather and waves endpoints used by status board internal checks
  ST -->|"GET /api/weather/island"| WIsland
  ST -->|"GET /api/weather/waves"| WWaves

  %% Weather routes call external providers and maintain providerHealth
  WIsland --> WRoutes
  WWaves --> WRoutes

  WRoutes -->|"fetchAllProvidersCurrent"| OM
  WRoutes -->|"fallback / aggregate"| WA
  WRoutes -->|"fallback / aggregate"| OW

  %% Marine + other providers (still called directly by API)
  WWaves --> Marine
  FlightApi["GET /api/flights"] --> Flights
  VesselsApi["GET /api/vessels"] --> Vessels

  %% Legend
  classDef internal fill:#0b1020,stroke:#1f2937,color:#f9fafb;
  classDef external fill:#111827,stroke:#4b5563,color:#e5e7eb;

  class StatusServer,ApiServer internal;
  class ExternalWeather,OtherExternal external;
```

