import { useDraggable } from '../hooks/useDraggable';

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

  if (!port) return null;

  const now = new Date();
  const upcomingCruises = (cruises || [])
    .map((c) => ({
      ...c,
      _eta: parseCruiseEtaToDate(c.etaLocalText || c.eta_localText || c.eta_local_text),
    }))
    .filter((c) => c._eta && c._eta >= now)
    .sort((a, b) => a._eta - b._eta);

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
            <span>🛬</span> Expected {upcomingCruises.length}
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
          {upcomingCruises.length === 0 && (
            <div className="airport-history-empty">No upcoming cruise calls found in the current schedule window.</div>
          )}
          {upcomingCruises.length > 0 && (
            <ul className="airport-history-list">
              {upcomingCruises.slice(0, 6).map((c, idx) => (
                <li key={idx}>
                  <strong>{c.shipName}</strong>
                  {c.operator && <> · <span>{c.operator}</span></>}
                  {c.etaLocalText && <> · <span>{c.etaLocalText}</span></>}
                </li>
              ))}
            </ul>
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

