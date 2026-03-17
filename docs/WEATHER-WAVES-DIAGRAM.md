## Weather and Wave Data Flow Diagram

The diagram below shows how weather and marine wave data is collected from external providers, cached in the backend, and then presented on the Jamaica map in the frontend.

```mermaid
flowchart LR
  %% Frontend
  subgraph Frontend["React Frontend (client)"]
    Map["Map components<br/>(MapSection, ParishZoomView)"]
    WeatherApiClient["client/src/api/weather.js"]
  end

  %% Backend
  subgraph Backend["Express API (server)"]
    WeatherRoutes["Weather routes<br/>server/routes/weather.js"]
    IslandEndpoint["GET /api/weather/island"]
    ParishEndpoint["GET /api/weather/parish/:slug"]
    PointEndpoint["GET /api/weather?lat=&lon="]
    WavesEndpoint["GET /api/weather/waves"]

    subgraph WeatherCache["In-memory weather caches"]
      PointCache["cache (single point)<br/>key: lat/lon or parish slug<br/>TTL: 10 min"]
      IslandCache["islandCache<br/>14 parishes<br/>TTL: 20 min"]
      WaveCache["waveCache<br/>coastal points<br/>TTL: 30 min"]
    end

    subgraph WeatherJobs["Background refresh"]
      RefreshTask["refreshWeatherAndWaves()<br/>every 20 min"]
    end
  end

  %% External providers
  subgraph WeatherProviders["External Weather Providers"]
    OpenMeteo["Open-Meteo<br/>/v1/forecast"]
    WeatherAPI["WeatherAPI<br/>/current.json"]
    OpenWeather["OpenWeatherMap<br/>/data/2.5/weather"]
  end

  subgraph MarineProviders["Marine / Waves Provider"]
    MarineAPI["Open-Meteo Marine<br/>/v1/marine"]
  end

  %% Frontend calls backend
  Map -->|"needs parish / island weather"| WeatherApiClient
  WeatherApiClient -->|"GET /api/weather/island"| IslandEndpoint
  WeatherApiClient -->|"GET /api/weather/parish/:slug"| ParishEndpoint
  WeatherApiClient -->|"GET /api/weather/waves"| WavesEndpoint

  %% Endpoints use caches and routes
  IslandEndpoint -->|"check TTL, else compute"| IslandCache
  ParishEndpoint -->|"check TTL, else compute"| PointCache
  PointEndpoint -->|"check TTL, else compute"| PointCache
  WavesEndpoint -->|"check TTL, else compute"| WaveCache

  IslandEndpoint --> WeatherRoutes
  ParishEndpoint --> WeatherRoutes
  PointEndpoint --> WeatherRoutes
  WavesEndpoint --> WeatherRoutes

  %% Weather routes call all providers and aggregate
  WeatherRoutes -->|"fetchAllProvidersCurrent()"<br/>per parish / point| OpenMeteo
  WeatherRoutes -->|"fallback / aggregate"| WeatherAPI
  WeatherRoutes -->|"fallback / aggregate"| OpenWeather

  %% Marine waves
  WeatherRoutes -->|"fetchWavesData()"<br/>per coastal point| MarineAPI

  %% Background refresh keeps island + waves fresh
  RefreshTask -->|"fetchIslandWeather()"<br/>for all 14 parishes| WeatherRoutes
  RefreshTask -->|"update islandCache"| IslandCache
  RefreshTask -->|"fetchWavesData()"| WeatherRoutes
  RefreshTask -->|"update waveCache"| WaveCache

  %% Data back to frontend map
  IslandEndpoint -->|"JSON list of 14 parishes<br/>{ slug, lat, lon, temperature, humidity, description, wind, cloudCover, sources }"| WeatherApiClient
  WavesEndpoint -->|"JSON list of coastal points<br/>{ id, name, lat, lon, waveHeight, waveDirection, wavePeriod }"| WeatherApiClient
  WeatherApiClient -->|"normalized data props"| Map

  %% Legend styles
  classDef frontend fill:#0b1020,stroke:#1f2937,color:#f9fafb;
  classDef backend fill:#111827,stroke:#4b5563,color:#e5e7eb;
  classDef external fill:#020617,stroke:#4b5563,color:#e5e7eb;

  class Frontend frontend;
  class Backend backend;
  class WeatherProviders,MarineProviders external;
```

