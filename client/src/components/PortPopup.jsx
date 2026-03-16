import { useDraggable } from '../hooks/useDraggable';
import { fetchWeather } from '../api/weather';
import { useEffect, useState } from 'react';

// Parse ETA text like "17 Mar 2026 - 09:30" into a Date
function parseCruiseEtaToDate(etaLocalText) {
  if (!etaLocalText || typeof etaLocalText !== 'string') return null;
  const cleaned = etaLocalText.replace('–', '-').trim();
  const parts = cleaned.split('-').map((s) => s.trim());
  if (!parts[0]) return null;
  const candidate = parts[1] ? `${parts[0]} ${parts[1]}` : parts[0];
  const d = new Date(candidate);
  return Number.isNaN(d.getTime()) ? null : d;
}

function PortPopup({ port, onClose, anchorPos, nearbyVessels = [], cruises = [] }) {
  const { pos, onMouseDown } = useDraggable();
  const [weather, setWeather] = useState(null);
  const [weatherError, setWeatherError] = useState(null);

  // Jamaica time (America/Jamaica = EST, UTC-5, no DST)
  const [jamaicaTime, setJamaicaTime] = useState(
    () => new Date().toLocaleTimeString('en-US', { timeZone: 'America/Jamaica', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  );

  useEffect(() => {
    const id = setInterval(() => {
      setJamaicaTime(
        new Date().toLocaleTimeString('en-US', { timeZone: 'America/Jamaica', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      );
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!port) return;
    setWeather(null);
    setWeatherError(null);
    fetchWeather(port.lat, port.lon)
      .then(setWeather)
      .catch((err) => setWeatherError(err.message || 'Failed to load weather'));
  }, [port]);

  if (!port) return null;

  const now = new Date();
  const monthFiltered = (cruises || [])
    .map((c) => ({
      ...c,
      _eta: parseCruiseEtaToDate(c.etaLocalText || c.eta_localText || c.eta_local_text),
    }))
    .filter((c) => {
      if (!c._eta) return false;
      return (
        c._eta.getFullYear() === now.getFullYear() &&
        c._eta.getMonth() === now.getMonth() &&
        c._eta >= now
      );
    })
    .sort((a, b) => a._eta - b._eta);

  const dockedShips = (nearbyVessels || []).map((v) => ({
    name: v.name || `MMSI ${v.mmsi}`,
    type: v.shipType || 'Vessel',
    sog: typeof v.sog === 'number' ? v.sog : null,
  }));

  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${port.lat},${port.lon}&travelmode=driving`;

  return (
    <div
      className={`airport-popup${anchorPos ? ' airport-popup-anchored' : ''}`}
      style={anchorPos
        ? { left: anchorPos.x + 'px', top: anchorPos.y + 'px', transform: `translate(${pos.x}px, ${pos.y}px)` }
        : { transform: `translate(${pos.x}px, ${pos.y}px)` }
      }
      onDoubleClick={onClose}
    >
      <div className="drag-handle" onMouseDown={onMouseDown}>
        <span className="drag-dots">&#x2807;</span>
        <span className="drag-hint">Drag to move · Double-click to close</span>
      </div>
      <button className="popup-close" onClick={onClose}>&times;</button>

      <div className="popup-image-area">
        <div className="popup-image-placeholder">
          <span className="placeholder-icon">⚓</span>
          <span className="placeholder-label">{port.city}</span>
        </div>
      </div>

      <div className="airport-popup-body">
        <h2 className="airport-popup-title">{port.name}</h2>

        <div className="airport-badges">
          <span className="airport-badge airport-badge-type">
            <span>⚓</span> {port.type === 'cruise' ? 'Cruise Port' : 'Cruise & Cargo Port'}
          </span>
          <span className="airport-badge airport-badge-code">
            {port.city}
          </span>
          <span className="airport-badge airport-badge-type">
            <span>🛬</span> Expected {monthFiltered.length}
          </span>
          <span className="airport-badge airport-badge-type">
            <span>🛥</span> In port {nearbyVessels.length}
          </span>
        </div>

        <div className="airport-info-grid">
          <div className="airport-info-row">
            <span className="airport-info-icon">📍</span>
            <div>
              <span className="airport-info-label">Location</span>
              <span className="airport-info-value">{port.city}, Jamaica</span>
            </div>
          </div>
          <div className="airport-info-row">
            <span className="airport-info-icon">🌊</span>
            <div>
              <span className="airport-info-label">Role</span>
              <span className="airport-info-value">
                {port.type === 'cruise' ? 'Major cruise embarkation port' : 'Cruise and cargo gateway for Jamaica'}
              </span>
            </div>
          </div>
          <div className="airport-info-row">
            <span className="airport-info-icon">☀</span>
            <div>
              <span className="airport-info-label">Weather &amp; time</span>
              <div className="port-meta-row">
                <span className="port-meta-chip" title="Local weather at this port">
                  {weatherError
                    ? 'Weather unavailable'
                    : weather
                    ? `${Math.round(weather.temperature)}°C · ${weather.description} · Humidity ${weather.humidity}% · Wind ${weather.windSpeed} km/h`
                    : 'Weather loading…'}
                </span>
                <span className="port-meta-chip" title="Jamaica time (EST, UTC−5)">
                  {jamaicaTime}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="airport-history">
          <h3 className="airport-history-title">Upcoming cruise calls</h3>
          {monthFiltered.length === 0 && (
            <div className="airport-history-empty">No upcoming cruise calls found in the current schedule window.</div>
          )}
          {monthFiltered.length > 0 && (
            <div className="cruise-table-wrapper">
              <table className="cruise-table">
                <thead>
                  <tr>
                    <th>Ship</th>
                    <th>Line</th>
                    <th>Arrival</th>
                  </tr>
                </thead>
                <tbody>
                  {monthFiltered.map((c, idx) => (
                    <tr key={idx}>
                      <td>{c.shipName}</td>
                      <td>{c.operator || '—'}</td>
                      <td>{c.etaLocalText || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="airport-history-title" style={{ marginTop: '16px' }}>Ships currently in port (AIS)</h3>
          {dockedShips.length === 0 && (
            <div className="airport-history-empty">There are no vessels currently within 3 km of this port.</div>
          )}
          {dockedShips.length > 0 && (
            <div className="cruise-table-wrapper">
              <table className="cruise-table">
                <thead>
                  <tr>
                    <th>Ship</th>
                    <th>Type</th>
                    <th>Speed</th>
                  </tr>
                </thead>
                <tbody>
                  {dockedShips.map((s, idx) => (
                    <tr key={idx}>
                      <td>{s.name}</td>
                      <td>{s.type}</td>
                      <td>{s.sog != null ? `${s.sog.toFixed(1)} kn` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="airport-history-empty" style={{ marginTop: '4px', fontSize: '0.7rem' }}>
            Schedules are gathered from a cruise calendar and are approximate.
          </div>
        </div>

        <a
          className="popup-directions-btn"
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="3 11 22 2 13 21 11 13 3 11" />
          </svg>
          Get Directions
        </a>
      </div>
    </div>
  );
}

export default PortPopup;

