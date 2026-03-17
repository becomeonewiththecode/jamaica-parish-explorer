## TODO / Future Work

- **Cruise schedules: Kingston Harbour & Errol Flynn Marina**
  - Identify reliable public schedule sources for Kingston Harbour and Errol Flynn Marina (Port Antonio).
  - Extend `server/routes/port-cruises.js` `PRIMARY_PORT_URLS` / `SECONDARY_PORT_URLS` to add these ports.
  - Implement or adapt HTML parsers for any new source layouts.
  - Add new port metadata entries (names, cities, coordinates if available) and ensure data is persisted in the cruise tables.
  - Update `server/status-board.js` `CRUISE_PORT_ENDPOINTS` so Kingston and Errol Flynn appear as separate pills under "Cruise schedules (all ports)".

