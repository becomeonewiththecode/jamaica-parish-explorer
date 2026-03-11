import { useState, useRef, useMemo } from 'react';
import PlacePopup from './PlacePopup';

const categoryStyles = {
  tourist_attraction: { color: '#ff5722', label: 'Attractions', icon: '\u{1F3DB}' },
  landmark: { color: '#9c27b0', label: 'Landmarks', icon: '\u{1F3F0}' },
  restaurant: { color: '#ff9800', label: 'Restaurants', icon: '\u{1F37D}' },
  cafe: { color: '#795548', label: 'Cafes', icon: '\u{2615}' },
  hotel: { color: '#2196f3', label: 'Hotels', icon: '\u{1F3E8}' },
  hospital: { color: '#f44336', label: 'Hospitals', icon: '\u{1F3E5}' },
  school: { color: '#607d8b', label: 'Schools', icon: '\u{1F393}' },
  beach: { color: '#00bcd4', label: 'Beaches', icon: '\u{1F3D6}' },
  place_of_worship: { color: '#e91e63', label: 'Worship', icon: '\u{26EA}' },
  bank: { color: '#4caf50', label: 'Banks', icon: '\u{1F3E6}' },
  gas_station: { color: '#ff5722', label: 'Gas Stations', icon: '\u{26FD}' },
  park: { color: '#8bc34a', label: 'Parks', icon: '\u{1F333}' },
  nightlife: { color: '#ce93d8', label: 'Nightlife', icon: '\u{1F378}' },
  shopping: { color: '#ffc107', label: 'Shopping', icon: '\u{1F6CD}' },
};

const ZOOM_WIDTH = 800;
const ZOOM_HEIGHT = 600;
const ZOOM_PADDING = 60;

function projectForFeature(feature) {
  const coords = feature.geometry.type === 'MultiPolygon'
    ? feature.geometry.coordinates.flat(1)
    : feature.geometry.coordinates;

  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const ring of coords) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }

  const lonRange = maxLon - minLon || 0.01;
  const latRange = maxLat - minLat || 0.01;
  const usableW = ZOOM_WIDTH - ZOOM_PADDING * 2;
  const usableH = ZOOM_HEIGHT - ZOOM_PADDING * 2;
  const scale = Math.min(usableW / lonRange, usableH / latRange);
  const offsetX = ZOOM_PADDING + (usableW - lonRange * scale) / 2;
  const offsetY = ZOOM_PADDING + (usableH - latRange * scale) / 2;

  function project(lon, lat) {
    return [
      (lon - minLon) * scale + offsetX,
      (maxLat - lat) * scale + offsetY,
    ];
  }

  const pathData = coords.map(ring => {
    const pts = ring.map(([lon, lat]) => {
      const [x, y] = project(lon, lat);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M${pts.join('L')}Z`;
  }).join(' ');

  return { project, pathData };
}

function ParishZoomView({ feature, parishName, parishSlug, parishColor, places, onClose }) {
  const [activeCategories, setActiveCategories] = useState(new Set());
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [hoveredPlace, setHoveredPlace] = useState(null);
  const containerRef = useRef(null);
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, place: null });

  const { project, pathData } = useMemo(() => {
    if (!feature) return { project: null, pathData: '' };
    return projectForFeature(feature);
  }, [feature]);

  const { markers, availableCategories } = useMemo(() => {
    if (!project || !places || !places.length) {
      return { markers: [], availableCategories: [] };
    }

    const catCounts = {};
    for (const p of places) {
      catCounts[p.category] = (catCounts[p.category] || 0) + 1;
    }
    const availableCategories = Object.entries(catCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => ({ category: cat, count }));

    const filtered = activeCategories.size === 0
      ? places
      : places.filter(p => activeCategories.has(p.category));

    const markers = filtered.map(p => {
      const [x, y] = project(p.lon, p.lat);
      const style = categoryStyles[p.category] || { color: '#fff', label: p.category };
      return { ...p, x, y, markerColor: style.color };
    });

    return { markers, availableCategories };
  }, [places, project, activeCategories]);

  const toggleCategory = (cat) => {
    setActiveCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handlePlaceHover = (place, e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setTooltip({
      visible: true,
      x: e.clientX - rect.left + 14,
      y: e.clientY - rect.top - 44,
      place,
    });
    setHoveredPlace(place.id);
  };

  const handlePlaceLeave = () => {
    setTooltip(prev => ({ ...prev, visible: false }));
    setHoveredPlace(null);
  };

  if (!feature) return null;

  return (
    <div className="parish-zoom-overlay">
      <div className="parish-zoom-panel">
        <div className="parish-zoom-header">
          <button className="zoom-back-btn" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to Jamaica
          </button>
          <h2 className="zoom-title">{parishName}</h2>
          <span className="zoom-place-count">{places.length} places</span>
        </div>

        {/* Category filters */}
        {availableCategories.length > 0 && (
          <div className="zoom-filters">
            <button
              className={`category-btn ${activeCategories.size === 0 ? 'active' : ''}`}
              onClick={() => setActiveCategories(new Set())}
            >
              All ({places.length})
            </button>
            {availableCategories.map(({ category, count }) => {
              const style = categoryStyles[category] || { color: '#fff', label: category };
              const isActive = activeCategories.has(category);
              return (
                <button
                  key={category}
                  className={`category-btn ${isActive ? 'active' : ''}`}
                  style={{ '--cat-color': style.color }}
                  onClick={() => toggleCategory(category)}
                >
                  <span className="cat-dot" />
                  {style.label} ({count})
                </button>
              );
            })}
          </div>
        )}

        {/* Zoomed SVG map */}
        <div className="zoom-map-container" ref={containerRef}>
          {tooltip.visible && tooltip.place && (
            <div
              className="place-tooltip"
              style={{ left: tooltip.x + 'px', top: tooltip.y + 'px' }}
            >
              <strong>{tooltip.place.name}</strong>
              <span className="place-tooltip-cat">
                {(categoryStyles[tooltip.place.category] || {}).label || tooltip.place.category}
              </span>
            </div>
          )}
          <svg
            className="zoom-map-svg"
            viewBox={`0 0 ${ZOOM_WIDTH} ${ZOOM_HEIGHT}`}
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Parish shape */}
            <path
              d={pathData}
              fill={parishColor || '#2e7d32'}
              stroke="#f0c040"
              strokeWidth="2"
              opacity="0.6"
            />
            {/* Place markers */}
            {markers.map(p => {
              const isSelected = selectedPlace && selectedPlace.id === p.id;
              const isHovered = hoveredPlace === p.id;
              const r = isSelected ? 7 : isHovered ? 6 : 4.5;
              return (
                <circle
                  key={p.id}
                  className={`place-marker ${isSelected ? 'selected' : ''}`}
                  cx={p.x}
                  cy={p.y}
                  r={r}
                  fill={p.markerColor}
                  stroke={isSelected ? '#fff' : '#0a1628'}
                  strokeWidth={isSelected ? 2 : 1}
                  onClick={(e) => { e.stopPropagation(); setSelectedPlace(p); }}
                  onMouseEnter={(e) => handlePlaceHover(p, e)}
                  onMouseMove={(e) => handlePlaceHover(p, e)}
                  onMouseLeave={handlePlaceLeave}
                />
              );
            })}
          </svg>
        </div>

        {/* Category legend */}
        {availableCategories.length > 0 && (
          <div className="zoom-legend">
            {availableCategories.map(({ category, count }) => {
              const style = categoryStyles[category] || { color: '#fff', label: category, icon: '' };
              return (
                <div key={category} className="zoom-legend-item">
                  <span className="zoom-legend-dot" style={{ background: style.color }} />
                  <span className="zoom-legend-label">{style.label}</span>
                  <span className="zoom-legend-count">{count}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Place detail popup */}
      {selectedPlace && (
        <PlacePopup
          place={selectedPlace}
          onClose={() => setSelectedPlace(null)}
        />
      )}
    </div>
  );
}

export default ParishZoomView;
