import { useState, useEffect, useCallback } from 'react';
import { Marker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { fetchFlights } from '../api/parishes';

const POLL_INTERVAL = 15000; // 15 seconds

function buildPlaneIcon(heading) {
  return L.divIcon({
    className: 'flight-leaflet-icon',
    html: `<div class="flight-icon-inner" style="transform:rotate(${heading || 0}deg)">✈</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function FlightTracker({ visible }) {
  const [flights, setFlights] = useState([]);
  const [lastUpdate, setLastUpdate] = useState(null);
  const map = useMap();

  const refresh = useCallback(async () => {
    try {
      const data = await fetchFlights();
      setFlights(data.flights || []);
      setLastUpdate(data.time ? new Date(data.time * 1000) : new Date());
    } catch (e) {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [visible, refresh]);

  if (!visible || flights.length === 0) return null;

  return (
    <>
      {flights.map(f => {
        const icon = buildPlaneIcon(f.heading);
        const altFt = f.altitude ? Math.round(f.altitude * 3.281) : null;
        const speedKts = f.velocity ? Math.round(f.velocity * 1.944) : null;

        return (
          <Marker
            key={f.icao24}
            position={[f.lat, f.lon]}
            icon={icon}
            zIndexOffset={1000}
          >
            <Tooltip direction="top" offset={[0, -14]} className="flight-leaflet-tooltip">
              <strong>{f.callsign || f.icao24}</strong><br />
              {f.origin_country && <span>{f.origin_country}<br /></span>}
              {altFt && <span>Alt: {altFt.toLocaleString()} ft<br /></span>}
              {speedKts && <span>Speed: {speedKts} kts<br /></span>}
              {f.on_ground && <span>On ground</span>}
            </Tooltip>
          </Marker>
        );
      })}
    </>
  );
}

export default FlightTracker;
