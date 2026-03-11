import { useState, useMemo } from 'react';

const categoryLabels = {
  tourist_attraction: 'Attractions',
  landmark: 'Landmarks',
  restaurant: 'Restaurants',
  cafe: 'Cafes',
  hotel: 'Hotels',
  hospital: 'Hospitals',
  school: 'Schools',
  beach: 'Beaches',
  place_of_worship: 'Places of Worship',
  bank: 'Banks',
  gas_station: 'Gas Stations',
  park: 'Parks',
  nightlife: 'Nightlife',
  shopping: 'Shopping',
};

const categoryColors = {
  tourist_attraction: '#ff5722',
  landmark: '#9c27b0',
  restaurant: '#ff9800',
  cafe: '#795548',
  hotel: '#2196f3',
  hospital: '#f44336',
  school: '#607d8b',
  beach: '#00bcd4',
  place_of_worship: '#e91e63',
  bank: '#4caf50',
  gas_station: '#ff5722',
  park: '#8bc34a',
  nightlife: '#ce93d8',
  shopping: '#ffc107',
};

function PlacesPanel({ places }) {
  const [activeFilter, setActiveFilter] = useState(null);
  const [expandedPlace, setExpandedPlace] = useState(null);

  const grouped = useMemo(() => {
    const map = {};
    for (const p of places) {
      if (!map[p.category]) map[p.category] = [];
      map[p.category].push(p);
    }
    return map;
  }, [places]);

  const filteredPlaces = useMemo(() => {
    if (!activeFilter) return places;
    return places.filter(p => p.category === activeFilter);
  }, [places, activeFilter]);

  if (!places.length) return null;

  const categoryCounts = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length);

  return (
    <div className="places-panel">
      <h3>Points of Interest ({places.length})</h3>

      <div className="places-filters">
        <button
          className={`places-filter-btn ${!activeFilter ? 'active' : ''}`}
          onClick={() => setActiveFilter(null)}
        >
          All
        </button>
        {categoryCounts.map(([cat, items]) => (
          <button
            key={cat}
            className={`places-filter-btn ${activeFilter === cat ? 'active' : ''}`}
            style={{ '--cat-color': categoryColors[cat] || '#888' }}
            onClick={() => setActiveFilter(activeFilter === cat ? null : cat)}
          >
            <span className="cat-dot" />
            {categoryLabels[cat] || cat} ({items.length})
          </button>
        ))}
      </div>

      <div className="places-list">
        {filteredPlaces.slice(0, 50).map(place => (
          <div
            key={place.id}
            className={`place-card ${expandedPlace === place.id ? 'expanded' : ''}`}
            onClick={() => setExpandedPlace(expandedPlace === place.id ? null : place.id)}
          >
            <div className="place-card-header">
              <span
                className="place-cat-dot"
                style={{ background: categoryColors[place.category] || '#888' }}
              />
              <span className="place-name">{place.name}</span>
              <span className="place-cat-label">
                {categoryLabels[place.category] || place.category}
              </span>
            </div>
            {expandedPlace === place.id && (
              <div className="place-details">
                {place.address && <div className="place-detail-row"><span className="detail-label">Address:</span> {place.address}</div>}
                {place.phone && <div className="place-detail-row"><span className="detail-label">Phone:</span> {place.phone}</div>}
                {place.website && (
                  <div className="place-detail-row">
                    <span className="detail-label">Website:</span>{' '}
                    <a href={place.website} target="_blank" rel="noopener noreferrer">{place.website}</a>
                  </div>
                )}
                {place.opening_hours && <div className="place-detail-row"><span className="detail-label">Hours:</span> {place.opening_hours}</div>}
                {place.cuisine && <div className="place-detail-row"><span className="detail-label">Cuisine:</span> {place.cuisine}</div>}
              </div>
            )}
          </div>
        ))}
        {filteredPlaces.length > 50 && (
          <p className="places-more">...and {filteredPlaces.length - 50} more</p>
        )}
      </div>
    </div>
  );
}

export default PlacesPanel;
