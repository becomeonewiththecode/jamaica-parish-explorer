# Weather and Wave Data — Collection, Use, and Display

This document describes how weather and wave (marine) data are collected, cached, and displayed in the Jamaica Parish Explorer.

---

## Data Sources

### Open-Meteo Weather API (Weather: temperature, rain, wind, cloud)

- **Provider:** [Open-Meteo](https://open-meteo.com/) (free, no API key)
- **Endpoint:** `https://api.open-meteo.com/v1/forecast`
- **Data requested:** Current conditions only: `temperature_2m`, `relative_humidity_2m`, `weather_code`, `wind_speed_10m`, `wind_direction_10m`, `cloud_cover`
- **Timezone:** `America/Jamaica`
- **Use:** One request per parish (14 parishes), using fixed parish capital/representative coordinates (see **Parish coordinates** below).

### Open-Meteo Marine API (Wave height, direction, period)

- **Provider:** [Open-Meteo Marine](https://open-meteo.com/en/docs/marine-weather-api)
- **Endpoint:** `https://marine-api.open-meteo.com/v1/marine`
- **Data requested:** Current: `wave_height`, `wave_direction`, `wave_period`
- **Options:** `cell_selection=sea` so the API returns a sea grid cell (wave data is over water).
- **Use:** One request per coastal point (13 points around Jamaica). Manchester has no coastline and has no wave point.

---

## Data Collection

### Parish coordinates (weather)

Weather is fetched for each of the 14 parishes at a single lat/lon per parish (capital or main town):

| Parish     | Location (approx.) | Coordinates (lat, lon) |
|-----------|---------------------|--------------------------|
| Hanover   | Lucea               | 18.45, -78.17           |
| Westmoreland | Savanna-la-Mar  | 18.22, -78.13           |
| St. James | Montego Bay         | 18.47, -77.92           |
| Trelawny  | Falmouth            | 18.49, -77.65           |
| St. Ann   | Ocho Rios / St. Ann's Bay | 18.41, -77.10 |
| St. Elizabeth | Black River     | 18.03, -77.85           |
| Manchester| Mandeville          | 18.04, -77.50           |
| Clarendon | May Pen             | 17.97, -77.25           |
| St. Mary  | Port Maria          | 18.37, -76.89           |
| St. Catherine | Spanish Town    | 17.99, -76.96           |
| St. Andrew| Half Way Tree       | 18.01, -76.79           |
| Kingston  | Kingston            | 17.997, -76.793         |
| St. Thomas| Morant Bay          | 17.88, -76.41           |
| Portland  | Port Antonio        | 18.18, -76.45           |

An alternate spelling `trelawney` is accepted and mapped to `trelawny` for the parish weather endpoint only.

### Coastal points (waves)

Wave data is fetched for 13 named coastal points. Positions are chosen so icons appear over water where possible. Manchester is the only parish with no coastline and has no wave point.

| Point              | Parish / area        | Approx. coordinates |
|--------------------|----------------------|----------------------|
| Negril             | Westmoreland         | 18.28, -78.35        |
| Montego Bay        | St. James            | 18.47, -77.92        |
| Falmouth (Trelawny)| Trelawny (offshore)  | 18.52, -77.65        |
| Ocho Rios          | St. Ann              | 18.41, -77.10        |
| Port Antonio       | Portland             | 18.18, -76.45        |
| Port Maria         | St. Mary             | 18.37, -76.89        |
| Morant Bay         | St. Thomas           | 17.88, -76.41        |
| Kingston Harbour   | Kingston / St. Andrew| 17.97, -76.79        |
| Old Harbour        | St. Catherine        | 17.94, -77.11        |
| Rocky Point        | Clarendon            | 17.77, -77.27        |
| Black River        | St. Elizabeth        | 18.03, -77.85        |
| Treasure Beach     | St. Elizabeth        | 17.89, -77.76        |
| Savanna-la-Mar     | Westmoreland         | 18.22, -78.13        |

### Refresh schedule

- **Island weather (all 14 parishes):** Refreshed every **20 minutes**.
  - On server startup: one full fetch runs immediately.
  - Then `setInterval(refreshWeatherAndWaves, 20 * 60 * 1000)` runs every 20 minutes.
  - Each parish is requested twice if the first attempt fails (retry once).
  - **All 14 parishes** are always returned: successful parishes have full data; failed ones have `error: true` and `description: 'Unavailable'` so the map can still show a marker.

- **Wave data (13 coastal points):** Refreshed in the same 20-minute cycle as island weather (same `refreshWeatherAndWaves()` function).
  - Each point is requested with up to two attempts; only successful points are stored in the wave cache.

- **Single-request caches:**  
  - `GET /api/weather?lat=...&lon=...` and `GET /api/weather/parish/:slug` use a separate short-lived cache (10 minutes) for ad-hoc requests.  
  - `GET /api/weather/island` and `GET /api/weather/waves` use the 20-minute island cache and 30-minute wave cache; they are also repopulated by the 20-minute background refresh.

---

## How the Data Is Used

### API routes (`server/routes/weather.js`)

| Route | Purpose | Cache / behaviour |
|-------|---------|-------------------|
| `GET /api/weather?lat=&lon=` | Weather at arbitrary coordinates | 10 min cache per lat/lon |
| `GET /api/weather/parish/:slug` | Weather for one parish (sidebar widget) | 10 min cache per slug; slug alias `trelawney` → `trelawny` |
| `GET /api/weather/island` | Weather for all 14 parishes (map layer) | 20 min cache; always returns 14 items (failed = `error: true`) |
| `GET /api/weather/waves` | Wave conditions at coastal points (map layer) | 30 min cache; list of successful points only |

### Caches

- **Island weather cache:** Holds the full 14-parish list. Refreshed every 20 minutes in the background and on first request if stale.
- **Wave cache:** Holds the list of coastal points with wave data. Refreshed every 20 minutes in the background and on first request if stale.
- **Single-request cache:** Used only for `GET /api/weather` and `GET /api/weather/parish/:slug`; 10-minute TTL.

---

## How the Data Is Displayed

### Map — Weather layer (toggle: “☀ Weather”)

- **When:** Weather view is ON and map zoom is between 9 and 10 (inclusive).
- **Data:** `GET /api/weather/island` (client calls `fetchWeatherIsland()` when the layer is active).
- **Per parish (14 total):**
  - **If data is OK:**  
    - **Cloud** icon (north of parish centre): opacity from cloud cover; drift from wind direction.  
    - **Wind** arrow (south-east): direction and speed.  
    - **Temperature** (south-west): current temp in °C; tooltip includes description, humidity, wind.  
    - **Rain:** If the weather code indicates rain (drizzle, rain, showers, thunderstorm), a rain overlay circle and a rain icon (north-east) are shown; tooltip shows parish name and description (e.g. “Moderate rain”).
  - **If data is unavailable (`error: true`):**  
    A single “—°” marker (grey style) at the temperature position with tooltip: “Weather unavailable · Next refresh within 20 min”. This ensures every parish (including e.g. St. Thomas, St. Elizabeth) always has at least one weather-related marker.

### Map — Wave layer (toggle: “🌊 Waves”)

- **When:** Waves view is ON and map zoom is between 9 and 11 (inclusive).
- **Data:** `GET /api/weather/waves` (client calls `fetchWavesIsland()`).
- **Per coastal point:** A wave icon (SVG wave symbol) is placed at the point’s lat/lon (from the API response when available, else the predefined coastal point). The icon is rotated to show the direction waves are moving; the label shows significant wave height in metres (e.g. `1.2m`). Tooltip includes name, wave height, period, and a note that the arrow is direction of wave movement.

### Sidebar — Parish weather widget

- **When:** A parish is selected in the app (sidebar open with parish detail).
- **Data:** `GET /api/weather/parish/:slug` (client calls `fetchWeatherForParish(parishSlug)`).
- **Display:** Temperature (°C), short description (e.g. “Partly cloudy”), humidity, wind speed, and Jamaica time. If the request fails, the widget shows “Unavailable”.

---

## File Reference

| File | Purpose |
|------|---------|
| `server/routes/weather.js` | Weather and wave API routes; parish/coastal definitions; 20-minute refresh; fetch and cache logic |
| `client/src/api/weather.js` | `fetchWeather()`, `fetchWeatherForParish()`, `fetchWeatherIsland()`, `fetchWavesIsland()` |
| `client/src/components/MapSection.jsx` | Weather and wave map layers; weather/wave icon builders; rain overlay; unavailable marker |
| `client/src/components/WeatherWidget.jsx` | Sidebar parish weather widget |
| `docs/WEATHER-AND-WAVE-DATA.md` | This document |

---

## Summary

- **Collection:** Weather from Open-Meteo (14 parishes, retry once per parish). Waves from Open-Meteo Marine (13 coastal points, up to two attempts per point). Island weather and wave caches are refreshed every **20 minutes** in the background and on first request when stale.
- **Use:** Island and wave data are cached and served by `GET /api/weather/island` and `GET /api/weather/waves`; parish widget uses `GET /api/weather/parish/:slug`. Every parish is always included in the island response (with `error: true` if fetch failed).
- **Display:** Map shows weather (cloud, wind, temp, rain when applicable) and optionally waves (height, direction) per parish/coastal point; sidebar shows current weather for the selected parish. Unavailable parishes still get a “—°” marker and “Weather unavailable · Next refresh within 20 min” on the map.
