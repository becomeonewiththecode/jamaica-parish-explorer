import { useState, useEffect, useCallback } from 'react';
import { Marker, Tooltip, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { fetchFlights } from '../api/parishes';

const POLL_INTERVAL = 30000; // 30 seconds (matches server live radar poll)

// Altitude-based colors (adsb.lol style: low → high = blue → green → yellow → orange → red)
const ALTITUDE_BANDS_FT = [
  [0, 10000, '#2196F3'],      // blue — low (approach / pattern)
  [10000, 25000, '#4CAF50'],  // green
  [25000, 35000, '#FFEB3B'],  // yellow
  [35000, 45000, '#FF9800'],  // orange
  [45000, Infinity, '#F44336'], // red — high
];
function colorByAltitudeFt(altFt) {
  if (altFt == null || !Number.isFinite(altFt) || altFt < 0) return '#9E9E9E'; // gray: ground / unknown
  for (const [low, high, color] of ALTITUDE_BANDS_FT) {
    if (altFt >= low && altFt < high) return color;
  }
  return ALTITUDE_BANDS_FT[ALTITUDE_BANDS_FT.length - 1][2];
}

// Build a rotated plane icon for live aircraft (color by altitude)
function buildLiveIcon(heading, altitudeM) {
  const altFt = altitudeM != null ? altitudeM * 3.281 : null;
  const color = colorByAltitudeFt(altFt);
  const opacity = '1';
  const size = '22px';
  return L.divIcon({
    className: 'flight-leaflet-icon',
    html: `<div class="flight-icon-inner" style="transform:rotate(${heading || 0}deg);color:${color};font-size:${size};opacity:${opacity};-webkit-text-stroke:0.5px rgba(255,255,255,0.5)">✈</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

// Legend control: altitude → color (adsb.lol style)
const LEGEND_ITEMS = [
  [null, 'Ground / unknown', '#9E9E9E'],
  [0, '0 – 10,000 ft', '#2196F3'],
  [10000, '10,000 – 25,000 ft', '#4CAF50'],
  [25000, '25,000 – 35,000 ft', '#FFEB3B'],
  [35000, '35,000 – 45,000 ft', '#FF9800'],
  [45000, '45,000+ ft', '#F44336'],
];

function FlightAltitudeLegend({ visible }) {
  const map = useMap();
  useEffect(() => {
    if (!visible) return;
    const Control = L.Control.extend({
      onAdd: () => {
        const el = document.createElement('div');
        el.className = 'flight-altitude-legend leaflet-control';
        el.innerHTML = `
          <div class="flight-altitude-legend-title">Altitude</div>
          ${LEGEND_ITEMS.map(([ft, label, color]) =>
            `<div class="flight-altitude-legend-row"><span class="flight-altitude-legend-swatch" style="background:${color}"></span><span class="flight-altitude-legend-label">${label}</span></div>`
          ).join('')}
        `;
        return el;
      },
    });
    const control = new Control({ position: 'bottomleft' });
    control.addTo(map);
    return () => { control.remove(); };
  }, [map, visible]);
  return null;
}

function FlightTracker({ visible, onAirportSelect, airports }) {
  const [data, setData] = useState(null);
  const map = useMap();

  const refresh = useCallback(async () => {
    try {
      const result = await fetchFlights();
      setData(result);
    } catch (e) {}
  }, []);

  useEffect(() => {
    if (!visible) return;
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [visible, refresh]);

  if (!visible || !data || !data.flights) return null;

  const flights = data.flights;
  const flightAirports = data.airports || [];

  // Separate scheduled (count badges) and live (plane markers) flights
  const scheduledFlights = flights.filter(f => f.dataSource === 'scheduled' || (!f.dataSource && f.scheduledTime));
  const getPosition = (f) => {
    const rawLat = f.lat ?? f.latitude ?? f.position?.lat ?? (Array.isArray(f.coordinates) && f.coordinates[0] != null ? f.coordinates[0] : null);
    const rawLon = f.lon ?? f.lng ?? f.longitude ?? f.position?.lon ?? (Array.isArray(f.coordinates) && f.coordinates[1] != null ? f.coordinates[1] : null);
    const lat = typeof rawLat === 'number' ? rawLat : parseFloat(rawLat);
    const lon = typeof rawLon === 'number' ? rawLon : parseFloat(rawLon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  };
  const hasValidPosition = (f) => getPosition(f) != null;
  const isLive = (f) =>
    f.dataSource === 'live' ||
    (!f.dataSource && !f.scheduledTime) ||
    (['arrival', 'departure', 'flyover'].includes(f.type) && (f.lat != null || f.latitude != null || f.position != null) && (f.lon != null || f.longitude != null || f.lng != null || f.position != null));
  let liveFlights = flights.filter(f => isLive(f) && hasValidPosition(f));
  // Include any live flyover that has position but was missed (e.g. alternate field names or type)
  const liveIds = new Set(liveFlights.map(f => f.id || f.callsign));
  for (const f of flights) {
    if (f.type === 'flyover' && f.dataSource === 'live' && !liveIds.has(f.id) && !liveIds.has((f.callsign || '').trim())) {
      const pos = getPosition(f);
      if (pos) {
        liveFlights = [...liveFlights, f];
        liveIds.add(f.id || f.callsign);
      }
    }
  }

  // Group ALL flights (scheduled + live) by airport for count badges
  const airportCounts = {};
  for (const ap of flightAirports) {
    airportCounts[ap.icao] = { ...ap, arrivals: 0, departures: 0 };
  }
  for (const f of flights) {
    if (f.type === 'arrival') {
      const iata = f.destIata || f.nearestAirport;
      const ap = flightAirports.find(a => a.iata === iata);
      if (ap && airportCounts[ap.icao]) airportCounts[ap.icao].arrivals++;
    }
    if (f.type === 'departure') {
      const iata = f.originIata || f.nearestAirport;
      const ap = flightAirports.find(a => a.iata === iata);
      if (ap && airportCounts[ap.icao]) airportCounts[ap.icao].departures++;
    }
  }

  return (
    <>
      <FlightAltitudeLegend visible={visible} />
      {/* Airport flight count badges (scheduled data) */}
      {Object.values(airportCounts).map(ap => {
        if (ap.arrivals === 0 && ap.departures === 0) return null;
        const icon = L.divIcon({
          className: 'flight-count-icon',
          html: `<div class="flight-count-inner"><span class="flight-count-arr">↓${ap.arrivals}</span><span class="flight-count-dep">↑${ap.departures}</span></div>`,
          iconSize: [52, 24],
          iconAnchor: [26, -8],
        });
        return (
          <Marker
            key={`fc-${ap.icao}`}
            position={[ap.lat, ap.lon]}
            icon={icon}
            zIndexOffset={900}
            eventHandlers={{ click: () => {
              const fullAirport = airports?.find(a => a.icao === ap.icao || a.code === ap.iata);
              if (fullAirport && onAirportSelect) onAirportSelect(fullAirport);
            }}}
          >
            <Tooltip direction="top" offset={[0, -16]} className="flight-leaflet-tooltip">
              <strong>{ap.name}</strong><br />
              Arrivals: {ap.arrivals} | Departures: {ap.departures}<br />
              <em>Click for flight info</em>
            </Tooltip>
          </Marker>
        );
      })}

      {/* Live aircraft approach/departure lines (not for flyovers) — line color by altitude for consistency */}
      {liveFlights.filter(f => f.type !== 'flyover').map(f => {
        const pos = getPosition(f);
        const airportLat = f.type === 'arrival' ? f.destLat : f.originLat;
        const airportLon = f.type === 'arrival' ? f.destLon : f.originLon;
        if (!pos || !airportLat || !airportLon) return null;
        const altFt = f.altitude != null ? f.altitude * 3.281 : null;
        const lineColor = colorByAltitudeFt(altFt);
        return (
          <Polyline
            key={`line-${f.id}`}
            positions={[[pos.lat, pos.lon], [airportLat, airportLon]]}
            pathOptions={{
              color: lineColor,
              weight: 1.5,
              opacity: 0.6,
              dashArray: '6, 8',
            }}
          />
        );
      })}

      {/* Live aircraft markers — color by altitude (adsb.lol style) */}
      {liveFlights.map((f, i) => {
        const pos = getPosition(f);
        if (!pos) return null;
        const icon = buildLiveIcon(f.heading, f.altitude);
        const altFt = f.altitude ? Math.round(f.altitude * 3.281) : null;
        const speedKts = f.velocity ? Math.round(f.velocity * 1.944) : null;
        const airportName = f.type === 'arrival' ? f.destName : f.type === 'departure' ? f.originName : null;
        const statusColor = colorByAltitudeFt(altFt);

        return (
          <Marker
            key={`plane-${f.id ?? f.callsign ?? i}-${i}`}
            position={[pos.lat, pos.lon]}
            icon={icon}
            zIndexOffset={f.type === 'flyover' ? 1000 : 1100}
          >
            <Tooltip direction="top" offset={[0, -14]} className="flight-leaflet-tooltip">
              <strong>{f.callsign || f.flightNumber || f.id}</strong><br />
              {f.airline && <span>{f.airline}<br /></span>}
              {f.type === 'arrival' && airportName && <span>→ {airportName}<br /></span>}
              {f.type === 'departure' && airportName && <span>← {airportName}<br /></span>}
              {f.type === 'flyover' && (
                <span style={{ color: '#90caf9' }}>
                  {(f.originName || f.from) && (f.destName || f.to)
                    ? <>From: {f.originName || f.from}{f.originIata || f.fromIata ? ` (${f.originIata || f.fromIata})` : ''}<br />To: {f.destName || f.to}{f.destIata || f.toIata ? ` (${f.destIata || f.toIata})` : ''}<br /></>
                    : (f.routeOrigin && f.routeDestination) ? <>{f.routeOrigin} → {f.routeDestination}<br /></>
                    : <><em>Route unknown</em><br /></>}
                </span>
              )}
              {f.aircraft && <span>{f.aircraft}{f.aircraftReg ? ` (${f.aircraftReg})` : ''}<br /></span>}
              {altFt != null && <span>Alt: {altFt.toLocaleString()} ft<br /></span>}
              {speedKts != null && <span>Speed: {speedKts} kts<br /></span>}
              <em style={{color: statusColor}}>
                {f.confirmedFlyover ? 'Overflying' : f.status || (f.type === 'flyover' ? 'Flyover' : f.type === 'arrival' ? 'Approaching' : 'Departing')}
              </em>
            </Tooltip>
          </Marker>
        );
      })}
    </>
  );
}

export default FlightTracker;
