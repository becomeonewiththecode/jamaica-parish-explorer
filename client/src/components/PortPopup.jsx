import { useEffect, useState } from 'react';
import { useDraggable } from '../hooks/useDraggable';
import { fetchPortCruises } from '../api/portCruises';

function PortPopup({ port, onClose, anchorPos, nearbyVessels = [] }) {
  const { pos, onMouseDown } = useDraggable();
  const [cruises, setCruises] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!port?.id) return;
    setLoading(true);
    setError('');
    fetchPortCruises(port.id)
      .then((data) => {
        if (cancelled) return;
        setCruises(Array.isArray(data.cruises) ? data.cruises : []);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Could not load cruise schedule.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [port?.id]);

  if (!port) return null;

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
            <span>🛬</span> Expected {cruises.length}
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
        </div>

        <div className="airport-history">
          <h3 className="airport-history-title">How to use on the map</h3>
          <ul className="airport-history-list">
            <li>Turn on <strong>Vessels</strong> to see live AIS ships near this port.</li>
            <li>Combine with <strong>Weather</strong> and <strong>Waves</strong> for sea conditions around the harbor.</li>
          </ul>
        </div>

        <div className="airport-history">
          <h3 className="airport-history-title">Upcoming cruise calls</h3>
          {loading && <div className="airport-history-empty">Loading schedule…</div>}
          {!loading && error && <div className="airport-history-empty">{error}</div>}
          {!loading && !error && cruises.length === 0 && (
            <div className="airport-history-empty">No upcoming cruise calls found in the current schedule window.</div>
          )}
          {!loading && !error && cruises.length > 0 && (
            <ul className="airport-history-list">
              {cruises.slice(0, 6).map((c, idx) => (
                <li key={idx}>
                  <strong>{c.shipName}</strong>
                  {c.operator && <> · <span>{c.operator}</span></>}
                  {c.etaLocalText && <> · <span>{c.etaLocalText}</span></>}
                  {c.source && <> · <span style={{ fontSize: '0.75rem', color: '#7a9cc6' }}>{c.source}</span></>}
                </li>
              ))}
            </ul>
          )}
          <div className="airport-history-empty" style={{ marginTop: '4px', fontSize: '0.7rem' }}>
            Schedules are scraped from public cruise calendars (CruiseDig / CruiseMapper) and may be approximate.
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

