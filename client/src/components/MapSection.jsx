import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Marker, Tooltip, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default icon path issue with bundlers (Vite/Webpack)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

import { fetchAirports } from '../api/parishes';
import { mapAirport } from '../data/airports';
import PlacePopup from './PlacePopup';
import AirportPopup from './AirportPopup';

const nameToSlug = {
  "Hanover": "hanover", "Westmoreland": "westmoreland",
  "Saint James": "st-james", "Trelawny": "trelawny",
  "Saint Ann": "st-ann", "Saint Elizabeth": "st-elizabeth",
  "Manchester": "manchester", "Clarendon": "clarendon",
  "Saint Mary": "st-mary", "Saint Catherine": "st-catherine",
  "Saint Andrew": "st-andrew", "Kingston": "kingston",
  "Saint Thomas": "st-thomas", "Portland": "portland",
};

const parishColors = {
  "hanover": "#2e7d32", "westmoreland": "#388e3c",
  "st-james": "#43a047", "trelawny": "#4caf50",
  "st-ann": "#66bb6a", "st-elizabeth": "#2e7d32",
  "manchester": "#388e3c", "clarendon": "#43a047",
  "st-mary": "#4caf50", "st-catherine": "#66bb6a",
  "st-andrew": "#2e7d32", "kingston": "#1b5e20",
  "st-thomas": "#388e3c", "portland": "#43a047",
};

const categoryStyles = {
  tourist_attraction: { color: '#ff5722', label: 'Attractions', icon: '🏛' },
  landmark: { color: '#9c27b0', label: 'Landmarks', icon: '🏰' },
  restaurant: { color: '#ff9800', label: 'Restaurants', icon: '🍽' },
  cafe: { color: '#795548', label: 'Cafes', icon: '☕' },
  hotel: { color: '#2196f3', label: 'Hotels', icon: '🏨' },
  hospital: { color: '#f44336', label: 'Hospitals', icon: '🏥' },
  school: { color: '#607d8b', label: 'Schools', icon: '🎓' },
  beach: { color: '#00bcd4', label: 'Beaches', icon: '🏖' },
  place_of_worship: { color: '#e91e63', label: 'Worship', icon: '⛪' },
  bank: { color: '#4caf50', label: 'Banks', icon: '🏦' },
  gas_station: { color: '#ff5722', label: 'Gas Stations', icon: '⛽' },
  park: { color: '#8bc34a', label: 'Parks', icon: '🌳' },
  nightlife: { color: '#ce93d8', label: 'Nightlife', icon: '🍸' },
  shopping: { color: '#ffc107', label: 'Shopping', icon: '🛍' },
};

// Jamaica bounds — tight to the island
const JAMAICA_CENTER = [18.11, -77.30];
const JAMAICA_BOUNDS = [[17.70, -78.40], [18.55, -76.18]];
const MAX_BOUNDS = [[17.65, -78.45], [18.60, -76.13]];

const airportIcon = L.divIcon({
  className: 'airport-leaflet-icon',
  html: '<div class="airport-icon-inner">✈</div>',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const starIcon = L.divIcon({
  className: 'highlight-star-leaflet',
  html: '<div class="highlight-star-icon">★</div>',
  iconSize: [32, 40],
  iconAnchor: [16, 40],
});

// Component to fly map to bounds when parish changes, and create custom panes
function FlyToBounds({ bounds, activeSlug }) {
  const map = useMap();

  // Create custom panes so GeoJSON is always below markers
  useEffect(() => {
    if (!map.getPane('parishPane')) {
      const pane = map.createPane('parishPane');
      pane.style.zIndex = 300; // below default marker pane (600)
    }
  }, [map]);

  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13, duration: 0.8 });
    } else {
      map.fitBounds(JAMAICA_BOUNDS, { padding: [20, 20], maxZoom: 10, duration: 0.8 });
    }
  }, [bounds, activeSlug, map]);
  return null;
}

function MapSection({ activeSlug, onSelect, parishPlaces, highlightedPlace, onClearHighlight }) {
  const [geojson, setGeojson] = useState(null);
  const [airports, setAirports] = useState([]);
  const [activeCategories, setActiveCategories] = useState(new Set());
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [selectedAirport, setSelectedAirport] = useState(null);
  const geoJsonRef = useRef(null);

  useEffect(() => {
    fetch('/jamaica-parishes.geojson')
      .then(r => r.json())
      .then(setGeojson)
      .catch(console.error);
    fetchAirports()
      .then(list => setAirports(list.map(mapAirport)))
      .catch(console.error);
  }, []);

  // Reset filters when parish changes
  useEffect(() => {
    setActiveCategories(new Set());
    setSelectedPlace(null);
  }, [activeSlug]);

  // Compute bounds for active parish
  const activeBounds = useMemo(() => {
    if (!activeSlug || !geojson) return null;
    const feature = geojson.features.find(f => nameToSlug[f.properties.shapeName] === activeSlug);
    if (!feature) return null;
    const layer = L.geoJSON(feature);
    return layer.getBounds();
  }, [activeSlug, geojson]);

  // Filter places by category
  const filteredPlaces = useMemo(() => {
    if (!parishPlaces || !parishPlaces.length) return [];
    if (activeCategories.size === 0) return parishPlaces;
    return parishPlaces.filter(p => activeCategories.has(p.category));
  }, [parishPlaces, activeCategories]);

  // Available categories for filter bar
  const availableCategories = useMemo(() => {
    if (!parishPlaces || !parishPlaces.length) return [];
    const catCounts = {};
    for (const p of parishPlaces) {
      catCounts[p.category] = (catCounts[p.category] || 0) + 1;
    }
    return Object.entries(catCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => ({ category: cat, count }));
  }, [parishPlaces]);

  const toggleCategory = useCallback((cat) => {
    setActiveCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  // GeoJSON style per parish feature — rendered in parishPane so markers stay on top
  const parishStyle = useCallback((feature) => {
    const slug = nameToSlug[feature.properties.shapeName];
    const isActive = slug === activeSlug;
    return {
      pane: 'parishPane',
      fillColor: parishColors[slug] || '#388e3c',
      fillOpacity: isActive ? 0.5 : 0.35,
      color: isActive ? '#f0c040' : '#1a3a5c',
      weight: isActive ? 3 : 1.2,
    };
  }, [activeSlug]);

  // GeoJSON event handlers
  const onEachFeature = useCallback((feature, layer) => {
    const name = feature.properties.shapeName;
    const slug = nameToSlug[name];

    layer.on({
      click: () => onSelect(slug),
      mouseover: (e) => {
        const l = e.target;
        l.setStyle({ weight: 2.5, color: '#f0c040', fillOpacity: 0.55 });
        l.bindTooltip(name, { sticky: true, className: 'parish-leaflet-tooltip' }).openTooltip();
      },
      mouseout: (e) => {
        if (geoJsonRef.current) {
          geoJsonRef.current.resetStyle(e.target);
        }
        e.target.unbindTooltip();
      },
    });
  }, [onSelect]);

  // Force GeoJSON re-render when activeSlug changes
  const geoJsonKey = useMemo(() => `geojson-${activeSlug || 'none'}`, [activeSlug]);

  return (
    <section id="map-section">
      {/* Header + filters */}
      <div className="map-top-bar">
        {activeSlug ? (
          <div className="parish-zoom-header">
            <button className="zoom-back-btn" onClick={() => onSelect(null)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Back to Jamaica
            </button>
            <h2 className="zoom-title">
              {geojson ? (geojson.features.find(f => nameToSlug[f.properties.shapeName] === activeSlug)?.properties.shapeName || activeSlug) : activeSlug}
            </h2>
            <span className="zoom-place-count">{parishPlaces ? parishPlaces.length : 0} places</span>
          </div>
        ) : (
          <div className="map-header">
            <h1>Jamaica</h1>
            <p className="subtitle">Click a parish to explore</p>
          </div>
        )}

        {/* Category filters when parish is selected */}
        {activeSlug && availableCategories.length > 0 && (
          <div className="zoom-filters">
            <button
              className={`category-btn ${activeCategories.size === 0 ? 'active' : ''}`}
              onClick={() => setActiveCategories(new Set())}
            >
              All ({parishPlaces ? parishPlaces.length : 0})
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
      </div>

      {/* Leaflet Map */}
      <div id="map-container">
        <MapContainer
          center={JAMAICA_CENTER}
          zoom={10}
          minZoom={9}
          maxZoom={18}
          maxBounds={MAX_BOUNDS}
          maxBoundsViscosity={1.0}
          style={{ width: '100%', height: '100%' }}
          zoomControl={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <FlyToBounds bounds={activeBounds} activeSlug={activeSlug} />

          {/* Parish boundaries */}
          {geojson && (
            <GeoJSON
              key={geoJsonKey}
              ref={geoJsonRef}
              data={geojson}
              style={parishStyle}
              onEachFeature={onEachFeature}
            />
          )}

          {/* Airport markers */}
          {airports.map(ap => (
            <Marker
              key={ap.code}
              position={[ap.lat, ap.lon]}
              icon={airportIcon}
              eventHandlers={{
                click: () => setSelectedAirport(ap),
              }}
            >
              <Tooltip direction="top" offset={[0, -16]} className="airport-leaflet-tooltip">
                ✈ {ap.shortName} ({ap.code})
              </Tooltip>
            </Marker>
          ))}

          {/* Place markers when a parish is selected */}
          {activeSlug && filteredPlaces.map(p => {
            const style = categoryStyles[p.category] || { color: '#fff', label: p.category, icon: '📍' };
            const isHighlighted = highlightedPlace && highlightedPlace.id === p.id;
            return (
              <CircleMarker
                key={p.id}
                center={[p.lat, p.lon]}
                radius={isHighlighted ? 10 : 6}
                pathOptions={{
                  fillColor: style.color,
                  fillOpacity: 0.9,
                  color: isHighlighted ? '#f0c040' : '#0a1628',
                  weight: isHighlighted ? 3 : 1,
                }}
                eventHandlers={{
                  click: () => setSelectedPlace(p),
                }}
              >
                <Tooltip direction="top" offset={[0, -6]} className="place-leaflet-tooltip">
                  <strong>{p.name}</strong><br />
                  <span style={{ fontSize: '0.75rem', color: '#7a9cc6' }}>{style.label}</span>
                </Tooltip>
              </CircleMarker>
            );
          })}

          {/* Highlighted place from search */}
          {highlightedPlace && activeSlug && (
            <Marker
              position={[highlightedPlace.lat, highlightedPlace.lon]}
              icon={starIcon}
              eventHandlers={{
                click: () => {
                  const full = parishPlaces?.find(p => p.id === highlightedPlace.id);
                  if (full) setSelectedPlace(full);
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -42]} permanent className="highlight-leaflet-tooltip">
                {highlightedPlace.name}
              </Tooltip>
            </Marker>
          )}
        </MapContainer>
      </div>

      {/* Category legend when parish selected */}
      {activeSlug && availableCategories.length > 0 && (
        <div className="zoom-legend">
          {availableCategories.map(({ category, count }) => {
            const style = categoryStyles[category] || { color: '#fff', label: category };
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

      {/* Place detail popup */}
      {selectedPlace && (
        <PlacePopup
          place={selectedPlace}
          onClose={() => setSelectedPlace(null)}
        />
      )}

      {/* Airport detail popup */}
      {selectedAirport && (
        <AirportPopup
          airport={selectedAirport}
          onClose={() => setSelectedAirport(null)}
        />
      )}
    </section>
  );
}

export default MapSection;
