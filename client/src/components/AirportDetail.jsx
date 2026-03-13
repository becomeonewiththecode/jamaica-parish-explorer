import { useState, useEffect, useRef } from 'react';
import { fetchFlights } from '../api/parishes';

function AirportDetail({ airport, onClose, onFlightSelect }) {
  const [imgError, setImgError] = useState(false);
  const [flightData, setFlightData] = useState(null);
  const [activeTab, setActiveTab] = useState('arrivals');
  const [showDirections, setShowDirections] = useState(false);
  const [originInput, setOriginInput] = useState('');
  const originRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchFlights()
        .then(data => { if (!cancelled) setFlightData(data); })
        .catch(() => {});
    };
    load();
    // Refresh every 15s to stay in sync with live radar data
    const interval = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [airport]);

  if (!airport) return null;

  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${airport.lat},${airport.lon}&travelmode=driving`;

  // Filter flights for this airport
  const airportFlights = flightData?.flights?.filter(
    f => f.destIata === airport.code || f.originIata === airport.code
  ) || [];

  // Classify: if dataSource is set use it, otherwise infer from presence of scheduledTime
  const isScheduled = (f) => f.dataSource === 'scheduled' || (!f.dataSource && f.scheduledTime);
  const isLive = (f) => f.dataSource === 'live' || (!f.dataSource && !f.scheduledTime);

  // Scheduled flights (AeroDataBox)
  const scheduledArrivals = airportFlights.filter(f => f.type === 'arrival' && isScheduled(f));
  const scheduledDepartures = airportFlights.filter(f => f.type === 'departure' && isScheduled(f));

  // Live flights (adsb.lol / OpenSky)
  const liveArrivals = airportFlights.filter(f => f.type === 'arrival' && isLive(f));
  const liveDepartures = airportFlights.filter(f => f.type === 'departure' && isLive(f));

  // Combined for tab counts
  const arrivals = airportFlights.filter(f => f.type === 'arrival');
  const departures = airportFlights.filter(f => f.type === 'departure');

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
      <div className="airport-directions-section">
        <button
          className="airport-detail-directions"
          onClick={() => {
            setShowDirections(!showDirections);
            if (!showDirections) setTimeout(() => originRef.current?.focus(), 100);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="3 11 22 2 13 21 11 13 3 11" />
          </svg>
          Get Directions
        </button>
        {showDirections && (
          <div className="airport-directions-form">
            <label className="airport-directions-label">Starting location in Jamaica</label>
            <input
              ref={originRef}
              className="airport-directions-input"
              type="text"
              placeholder="e.g. Montego Bay, Half Way Tree, Ocho Rios"
              value={originInput}
              onChange={(e) => setOriginInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && originInput.trim()) {
                  const origin = encodeURIComponent(originInput.trim() + ', Jamaica');
                  window.open(`https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${airport.lat},${airport.lon}&travelmode=driving`, '_blank');
                }
              }}
            />
            <a
              className={`airport-directions-go${originInput.trim() ? '' : ' disabled'}`}
              href={originInput.trim() ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originInput.trim() + ', Jamaica')}&destination=${airport.lat},${airport.lon}&travelmode=driving` : '#'}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => { if (!originInput.trim()) e.preventDefault(); }}
            >
              Open in Google Maps
            </a>
          </div>
        )}
      </div>

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

      {/* Flight board — always shown */}
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
          {/* Scheduled flights section */}
          {(activeTab === 'arrivals' ? scheduledArrivals : scheduledDepartures).length > 0 && (
            <div className="airport-flight-section-label">Scheduled</div>
          )}
          {(activeTab === 'arrivals' ? scheduledArrivals : scheduledDepartures).map((f, i) => {
            const trackId = (f.flightNumber || '').replace(/\s/g, '');
            return (
              <div key={`s-${i}`} className="airport-flight-row">
                <span className="airport-flight-number">{f.flightNumber}</span>
                <span className="airport-flight-airline">{f.airline || ''}</span>
                <span className="airport-flight-route">
                  {activeTab === 'arrivals' ? `${f.from} (${f.fromIata})` : `${f.to} (${f.toIata})`}
                </span>
                <span className="airport-flight-time">{f.scheduledTime?.slice(11, 16) || '--:--'}</span>
                <span className={`airport-flight-status airport-flight-status-${(f.status || '').toLowerCase().replace(/\s/g, '')}`}>
                  {f.status}
                </span>
                {trackId && (
                  <span className="airport-flight-track">
                    <a href={`https://www.flightradar24.com/${trackId}`} target="_blank" rel="noopener noreferrer" title="Track on Flightradar24">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9 9 4.03 9 9z"/><path d="M12 3v9l6 3"/></svg>
                    </a>
                  </span>
                )}
              </div>
            );
          })}

          {/* Live radar flights section */}
          {(activeTab === 'arrivals' ? liveArrivals : liveDepartures).length > 0 && (
            <div className="airport-flight-section-label">Live Radar</div>
          )}
          {(activeTab === 'arrivals' ? liveArrivals : liveDepartures).map((f, i) => {
            const altFt = f.altitude ? Math.round(f.altitude * 3.281) : null;
            const trackId = (f.flightNumber || f.callsign || '').replace(/\s/g, '');
            const hasPosition = f.lat && f.lon;
            return (
              <div key={`l-${i}`} className="airport-flight-row airport-flight-row-live">
                <span className="airport-flight-number">{f.flightNumber || f.callsign || '---'}</span>
                <span className="airport-flight-airline">{f.airline || ''}</span>
                <span className="airport-flight-route">
                  {f.aircraft || ''}{f.aircraftReg ? ` (${f.aircraftReg})` : ''}
                </span>
                <span className="airport-flight-time">{altFt ? `${altFt.toLocaleString()}ft` : '---'}</span>
                <span className={`airport-flight-status airport-flight-status-${(f.status || '').toLowerCase().replace(/\s/g, '')}`}>
                  {f.status}
                </span>
                <span className="airport-flight-track">
                  {hasPosition && (
                    <button
                      className="airport-flight-locate"
                      title="Show on map"
                      onClick={() => onFlightSelect && onFlightSelect(f)}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4m-10-10h4m12 0h4"/></svg>
                    </button>
                  )}
                  {trackId && (
                    <a href={`https://www.flightradar24.com/${trackId}`} target="_blank" rel="noopener noreferrer" title="Track on Flightradar24">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9 9 4.03 9 9z"/><path d="M12 3v9l6 3"/></svg>
                    </a>
                  )}
                </span>
              </div>
            );
          })}

          {(activeTab === 'arrivals' ? arrivals : departures).length === 0 && (
            <div className="airport-flight-empty">No {activeTab} at this time</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AirportDetail;
