import { useState, useEffect, useCallback } from 'react';
import { Marker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { fetchFlights } from '../api/parishes';

const POLL_INTERVAL = 900000; // 15 minutes (matches server poll schedule)

const arrivalIcon = L.divIcon({
  className: 'flight-leaflet-icon',
  html: '<div class="flight-icon-inner flight-icon-arrival">✈</div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

const departureIcon = L.divIcon({
  className: 'flight-leaflet-icon',
  html: '<div class="flight-icon-inner flight-icon-departure">✈</div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

// For OpenSky live data fallback
function buildLiveIcon(heading) {
  return L.divIcon({
    className: 'flight-leaflet-icon',
    html: `<div class="flight-icon-inner" style="transform:rotate(${heading || 0}deg)">✈</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function FlightTracker({ visible }) {
  const [data, setData] = useState(null);
  const [showBoard, setShowBoard] = useState(false);
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

  if (!visible || !data || !data.flights || data.flights.length === 0) return null;

  const flights = data.flights;
  const source = data.source;
  const airports = data.airports || [];

  // For AeroDataBox data: show markers at airport positions
  if (source === 'aerodatabox') {
    // Group flights by airport
    const airportFlights = {};
    for (const ap of airports) {
      airportFlights[ap.icao] = { ...ap, arrivals: 0, departures: 0 };
    }
    for (const f of flights) {
      if (f.type === 'arrival' && f.destIata) {
        const ap = airports.find(a => a.iata === f.destIata);
        if (ap && airportFlights[ap.icao]) airportFlights[ap.icao].arrivals++;
      }
      if (f.type === 'departure' && f.originIata) {
        const ap = airports.find(a => a.iata === f.originIata);
        if (ap && airportFlights[ap.icao]) airportFlights[ap.icao].departures++;
      }
    }

    const arrivals = flights.filter(f => f.type === 'arrival');
    const departures = flights.filter(f => f.type === 'departure');

    return (
      <>
        {/* Airport flight count markers */}
        {Object.values(airportFlights).map(ap => {
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
              eventHandlers={{ click: () => setShowBoard(!showBoard) }}
            >
              <Tooltip direction="top" offset={[0, -16]} className="flight-leaflet-tooltip">
                <strong>{ap.name}</strong><br />
                Arrivals: {ap.arrivals} | Departures: {ap.departures}<br />
                <em>Click for flight board</em>
              </Tooltip>
            </Marker>
          );
        })}

        {/* Flight info board */}
        {showBoard && (
          <div className="flight-board" onClick={(e) => e.stopPropagation()}>
            <div className="flight-board-header">
              <span>✈ Jamaica Flights</span>
              <button onClick={() => setShowBoard(false)}>&times;</button>
            </div>
            <div className="flight-board-tabs">
              <span className="flight-board-tab flight-board-tab-arr">Arrivals ({arrivals.length})</span>
              <span className="flight-board-tab flight-board-tab-dep">Departures ({departures.length})</span>
            </div>
            <div className="flight-board-list">
              {arrivals.length > 0 && (
                <>
                  <div className="flight-board-section">ARRIVALS</div>
                  {arrivals.map((f, i) => (
                    <div key={`arr-${i}`} className="flight-board-row">
                      <span className="fb-flight">{f.flightNumber}</span>
                      <span className="fb-route">{f.from} ({f.fromIata})</span>
                      <span className="fb-time">{f.scheduledTime?.slice(11, 16) || '--:--'}</span>
                      <span className={`fb-status fb-status-${f.status?.toLowerCase().replace(/\s/g, '')}`}>{f.status}</span>
                    </div>
                  ))}
                </>
              )}
              {departures.length > 0 && (
                <>
                  <div className="flight-board-section">DEPARTURES</div>
                  {departures.map((f, i) => (
                    <div key={`dep-${i}`} className="flight-board-row">
                      <span className="fb-flight">{f.flightNumber}</span>
                      <span className="fb-route">{f.to} ({f.toIata})</span>
                      <span className="fb-time">{f.scheduledTime?.slice(11, 16) || '--:--'}</span>
                      <span className={`fb-status fb-status-${f.status?.toLowerCase().replace(/\s/g, '')}`}>{f.status}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        )}
      </>
    );
  }

  // OpenSky live data: show markers at actual positions
  return (
    <>
      {flights.map(f => {
        const icon = buildLiveIcon(f.heading);
        const altFt = f.altitude ? Math.round(f.altitude * 3.281) : null;
        const speedKts = f.velocity ? Math.round(f.velocity * 1.944) : null;
        return (
          <Marker
            key={f.id}
            position={[f.lat, f.lon]}
            icon={icon}
            zIndexOffset={1000}
          >
            <Tooltip direction="top" offset={[0, -14]} className="flight-leaflet-tooltip">
              <strong>{f.callsign || f.id}</strong><br />
              {f.from && <span>From: {f.from}<br /></span>}
              {altFt && <span>Alt: {altFt.toLocaleString()} ft<br /></span>}
              {speedKts && <span>Speed: {speedKts} kts<br /></span>}
            </Tooltip>
          </Marker>
        );
      })}
    </>
  );
}

export default FlightTracker;
