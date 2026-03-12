import { useState } from 'react';
import { useDraggable } from '../hooks/useDraggable';

function AirportPopup({ airport, onClose }) {
  const [imgError, setImgError] = useState(false);
  const { pos, onMouseDown } = useDraggable();

  if (!airport) return null;

  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${airport.lat},${airport.lon}&travelmode=driving`;

  return (
    <div
      className="airport-popup"
      style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      onDoubleClick={onClose}
    >
      <div className="drag-handle" onMouseDown={onMouseDown}>
        <span className="drag-dots">&#x2807;</span>
        <span className="drag-hint">Drag to move &middot; Double-click to close</span>
      </div>
      <button className="popup-close" onClick={onClose}>&times;</button>

      {/* Airport image */}
      <div className="popup-image-area">
        {!imgError ? (
          <img
            className="popup-image"
            src={airport.imageUrl}
            alt={airport.name}
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="popup-image-placeholder">
            <span className="placeholder-icon">✈️</span>
            <span className="placeholder-label">{airport.shortName}</span>
          </div>
        )}
      </div>

      {/* Airport info */}
      <div className="airport-popup-body">
        <h2 className="airport-popup-title">{airport.name}</h2>

        {/* Type + Code badges */}
        <div className="airport-badges">
          <span className="airport-badge airport-badge-type">
            <span>✈</span> {airport.type}
          </span>
          <span className="airport-badge airport-badge-code">
            {airport.code} / {airport.icao}
          </span>
        </div>

        {/* Quick info grid */}
        <div className="airport-info-grid">
          <div className="airport-info-row">
            <span className="airport-info-icon">🛬</span>
            <div>
              <span className="airport-info-label">Runway</span>
              <span className="airport-info-value">{airport.runway}</span>
            </div>
          </div>
          <div className="airport-info-row">
            <span className="airport-info-icon">📍</span>
            <div>
              <span className="airport-info-label">Serves</span>
              <span className="airport-info-value">{airport.serves}</span>
            </div>
          </div>
          <div className="airport-info-row">
            <span className="airport-info-icon">👤</span>
            <div>
              <span className="airport-info-label">Named After</span>
              <span className="airport-info-value">{airport.namedAfter}</span>
            </div>
          </div>
          <div className="airport-info-row">
            <span className="airport-info-icon">📅</span>
            <div>
              <span className="airport-info-label">Officially Opened</span>
              <span className="airport-info-value">{airport.opened}</span>
            </div>
          </div>
          <div className="airport-info-row">
            <span className="airport-info-icon">⬆️</span>
            <div>
              <span className="airport-info-label">Elevation</span>
              <span className="airport-info-value">{airport.elevation}</span>
            </div>
          </div>
          <div className="airport-info-row">
            <span className="airport-info-icon">🏢</span>
            <div>
              <span className="airport-info-label">Operator</span>
              <span className="airport-info-value">{airport.operator}</span>
            </div>
          </div>
          {airport.website && (
            <div className="airport-info-row">
              <span className="airport-info-icon">🌐</span>
              <div>
                <span className="airport-info-label">Website</span>
                <a
                  className="airport-info-link"
                  href={airport.website}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {airport.website.replace(/^https?:\/\/(www\.)?/, '')}
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Historical facts */}
        <div className="airport-history">
          <h3 className="airport-history-title">Historical Facts</h3>
          <ul className="airport-history-list">
            {airport.historicalFacts.map((fact, i) => (
              <li key={i}>{fact}</li>
            ))}
          </ul>
        </div>

        {/* Directions button */}
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

export default AirportPopup;
