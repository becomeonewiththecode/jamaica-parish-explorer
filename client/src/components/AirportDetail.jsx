import { useState, useEffect } from 'react';
import { fetchFlights } from '../api/parishes';

function AirportDetail({ airport, onClose }) {
  const [imgError, setImgError] = useState(false);
  const [flightData, setFlightData] = useState(null);
  const [activeTab, setActiveTab] = useState('arrivals');

  useEffect(() => {
    fetchFlights()
      .then(data => setFlightData(data))
      .catch(() => {});
  }, [airport]);

  if (!airport) return null;

  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${airport.lat},${airport.lon}&travelmode=driving`;

  // Filter flights for this airport
  const arrivals = flightData?.flights?.filter(
    f => f.type === 'arrival' && f.destIata === airport.code
  ) || [];
  const departures = flightData?.flights?.filter(
    f => f.type === 'departure' && f.originIata === airport.code
  ) || [];

  return (
    <div className="airport-detail">
      {/* Airport image */}
      <div className="airport-detail-image-area">
        {!imgError ? (
          <img
            className="airport-detail-image"
            src={airport.imageUrl}
            alt={airport.name}
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="airport-detail-image-placeholder">
            <span>✈️</span>
            <span>{airport.shortName}</span>
          </div>
        )}
      </div>

      {/* Airport name + codes */}
      <h2 className="airport-detail-title">{airport.name}</h2>
      <div className="airport-detail-badges">
        <span className="airport-badge airport-badge-type">✈ {airport.type}</span>
        <span className="airport-badge airport-badge-code">{airport.code} / {airport.icao}</span>
      </div>

      {/* Quick info grid */}
      <div className="airport-detail-grid">
        {airport.runway && (
          <div className="airport-detail-row">
            <span className="airport-detail-icon">🛬</span>
            <span className="airport-detail-label">Runway</span>
            <span className="airport-detail-value">{airport.runway}</span>
          </div>
        )}
        {airport.serves && (
          <div className="airport-detail-row">
            <span className="airport-detail-icon">📍</span>
            <span className="airport-detail-label">Serves</span>
            <span className="airport-detail-value">{airport.serves}</span>
          </div>
        )}
        {airport.namedAfter && (
          <div className="airport-detail-row">
            <span className="airport-detail-icon">👤</span>
            <span className="airport-detail-label">Named After</span>
            <span className="airport-detail-value">{airport.namedAfter}</span>
          </div>
        )}
        {airport.opened && (
          <div className="airport-detail-row">
            <span className="airport-detail-icon">📅</span>
            <span className="airport-detail-label">Opened</span>
            <span className="airport-detail-value">{airport.opened}</span>
          </div>
        )}
        {airport.elevation && (
          <div className="airport-detail-row">
            <span className="airport-detail-icon">⬆️</span>
            <span className="airport-detail-label">Elevation</span>
            <span className="airport-detail-value">{airport.elevation}</span>
          </div>
        )}
        {airport.operator && (
          <div className="airport-detail-row">
            <span className="airport-detail-icon">🏢</span>
            <span className="airport-detail-label">Operator</span>
            <span className="airport-detail-value">{airport.operator}</span>
          </div>
        )}
        {airport.website && (
          <div className="airport-detail-row">
            <span className="airport-detail-icon">🌐</span>
            <span className="airport-detail-label">Website</span>
            <a className="airport-detail-link" href={airport.website} target="_blank" rel="noopener noreferrer">
              {airport.website.replace(/^https?:\/\/(www\.)?/, '')}
            </a>
          </div>
        )}
      </div>

      {/* Directions */}
      <a className="airport-detail-directions" href={mapsUrl} target="_blank" rel="noopener noreferrer">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="3 11 22 2 13 21 11 13 3 11" />
        </svg>
        Get Directions
      </a>

      {/* Historical facts */}
      {airport.historicalFacts && airport.historicalFacts.length > 0 && (
        <div className="airport-detail-history">
          <h3>Historical Facts</h3>
          <ul>
            {airport.historicalFacts.map((fact, i) => (
              <li key={i}>{fact}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Flight board */}
      {flightData && flightData.source === 'aerodatabox' && (arrivals.length > 0 || departures.length > 0) && (
        <div className="airport-detail-flights">
          <h3>Flight Board</h3>
          <div className="airport-flight-tabs">
            <button
              className={`airport-flight-tab${activeTab === 'arrivals' ? ' active' : ''}`}
              onClick={() => setActiveTab('arrivals')}
            >
              Arrivals ({arrivals.length})
            </button>
            <button
              className={`airport-flight-tab${activeTab === 'departures' ? ' active' : ''}`}
              onClick={() => setActiveTab('departures')}
            >
              Departures ({departures.length})
            </button>
          </div>
          <div className="airport-flight-list">
            {(activeTab === 'arrivals' ? arrivals : departures).map((f, i) => (
              <div key={i} className="airport-flight-row">
                <span className="airport-flight-number">{f.flightNumber}</span>
                <span className="airport-flight-route">
                  {activeTab === 'arrivals' ? `${f.from} (${f.fromIata})` : `${f.to} (${f.toIata})`}
                </span>
                <span className="airport-flight-time">{f.scheduledTime?.slice(11, 16) || '--:--'}</span>
                <span className={`airport-flight-status airport-flight-status-${(f.status || '').toLowerCase().replace(/\s/g, '')}`}>
                  {f.status}
                </span>
              </div>
            ))}
            {(activeTab === 'arrivals' ? arrivals : departures).length === 0 && (
              <div className="airport-flight-empty">No {activeTab} scheduled</div>
            )}
          </div>
        </div>
      )}

      {flightData && flightData.source !== 'aerodatabox' && (
        <div className="airport-detail-flights">
          <p className="airport-flight-empty">Flight schedule data not currently available</p>
        </div>
      )}
    </div>
  );
}

export default AirportDetail;
