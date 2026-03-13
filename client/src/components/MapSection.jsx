import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, GeoJSON, Marker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default icon path issue with bundlers (Vite/Webpack)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

import { fetchAirports, fetchAllPlaces } from '../api/parishes';
import { mapAirport } from '../data/airports';
import PlacePopup from './PlacePopup';
import AirportPopup from './AirportPopup';
import FlightTracker from './FlightTracker';

// "Always on" categories — visible on map when zoomed in, no parish selection needed
const ALWAYS_ON_CATEGORIES = ['hotel', 'resort', 'guest_house', 'restaurant', 'beach'];
const ALWAYS_ON_MIN_ZOOM = 10; // Show when zoom >= this level

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
  guest_house: { color: '#5c6bc0', label: 'Guest Houses', icon: '🏡' },
  resort: { color: '#0288d1', label: 'Resorts', icon: '🌴' },
  hospital: { color: '#f44336', label: 'Hospitals', icon: '🏥' },
  school: { color: '#607d8b', label: 'Schools', icon: '🎓' },
  beach: { color: '#00bcd4', label: 'Beaches', icon: '🏖' },
  place_of_worship: { color: '#e91e63', label: 'Worship', icon: '⛪' },
  bank: { color: '#4caf50', label: 'Banks', icon: '🏦' },
  gas_station: { color: '#ff5722', label: 'Gas Stations', icon: '⛽' },
  park: { color: '#8bc34a', label: 'Parks', icon: '🌳' },
  nightlife: { color: '#ce93d8', label: 'Nightlife', icon: '🍸' },
  shopping: { color: '#ffc107', label: 'Shopping', icon: '🛍' },
  car_rental: { color: '#e65100', label: 'Car Rental', icon: '🚗' },
  stadium: { color: '#1b5e20', label: 'Stadiums', icon: '🏟' },
};

// Jamaica bounds — tight to the island
const JAMAICA_CENTER = [18.11, -77.30];
const JAMAICA_BOUNDS = [[17.70, -78.40], [18.55, -76.18]];
const MAX_BOUNDS = [[17.65, -78.45], [18.60, -76.13]];

// Pre-build a Leaflet divIcon for each category
function buildCategoryIcon(emoji, color) {
  return L.divIcon({
    className: 'category-leaflet-icon',
    html: `<div class="cat-icon-inner" style="background:${color};border-color:${color}"><span>${emoji}</span></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

const categoryIcons = {};
for (const [cat, s] of Object.entries(categoryStyles)) {
  categoryIcons[cat] = buildCategoryIcon(s.icon, s.color);
}
const defaultPlaceIcon = buildCategoryIcon('📍', '#888');

function buildHighlightIcon(emoji, color) {
  return L.divIcon({
    className: 'category-leaflet-icon',
    html: `<div class="cat-icon-inner cat-icon-highlight" style="background:${color};border-color:#f0c040"><span>${emoji}</span></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

const categoryIconsHighlight = {};
for (const [cat, s] of Object.entries(categoryStyles)) {
  categoryIconsHighlight[cat] = buildHighlightIcon(s.icon, s.color);
}
const defaultHighlightIcon = buildHighlightIcon('📍', '#888');

// Build a fresh focus icon each call so CSS animation always restarts
function buildFocusIcon(emoji, color) {
  return L.divIcon({
    className: 'category-leaflet-icon',
    html: `<div class="cat-icon-inner cat-icon-focus" style="background:${color};border-color:#fff"><span>${emoji}</span></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

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
function FlyToPlace({ place }) {
  const map = useMap();
  useEffect(() => {
    if (place && place.lat && place.lon) {
      map.flyTo([place.lat, place.lon], 16, { duration: 0.8 });
    }
  }, [place, map]);
  return null;
}

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

function MapRefExporter({ mapRef }) {
  const map = useMap();
  useEffect(() => { mapRef.current = map; }, [map, mapRef]);
  return null;
}

function ClosePopupOnMove({ onClose }) {
  const map = useMap();
  useEffect(() => {
    if (!onClose) return;
    map.on('movestart', onClose);
    return () => { map.off('movestart', onClose); };
  }, [map, onClose]);
  return null;
}

function ZoomTracker({ onZoomChange }) {
  const map = useMap();
  useEffect(() => {
    const handler = () => onZoomChange(map.getZoom());
    map.on('zoomend', handler);
    onZoomChange(map.getZoom()); // initial
    return () => { map.off('zoomend', handler); };
  }, [map, onZoomChange]);
  return null;
}

function MapSection({ activeSlug, onSelect, parishPlaces, highlightedPlace, onClearHighlight, activeCategories, onCategoriesChange, focusPlace, focusKey }) {
  const [geojson, setGeojson] = useState(null);
  const [airports, setAirports] = useState([]);
  const [alwaysOnPlaces, setAlwaysOnPlaces] = useState([]);
  const [currentZoom, setCurrentZoom] = useState(10);
  const [showFlights, setShowFlights] = useState(true);
  const setActiveCategories = onCategoriesChange;
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [selectedAirport, setSelectedAirport] = useState(null);
  const [popupPos, setPopupPos] = useState(null);
  const mapRef = useRef(null);
  const geoJsonRef = useRef(null);

  const getPopupPosition = useCallback((lat, lon) => {
    const map = mapRef.current;
    if (!map) return null;
    const pt = map.latLngToContainerPoint([lat, lon]);
    const mapEl = map.getContainer();
    const rect = mapEl.getBoundingClientRect();
    // Convert to screen coordinates
    const screenX = rect.left + pt.x;
    const screenY = rect.top + pt.y;
    // Position popup to the right of the marker, or above if near the right edge
    const popupWidth = 240;
    const popupHeight = 350;
    let x, y;
    if (screenX + 40 + popupWidth < window.innerWidth) {
      x = screenX + 30;
    } else {
      x = screenX - popupWidth - 30;
    }
    if (screenY - popupHeight / 2 > 0 && screenY + popupHeight / 2 < window.innerHeight) {
      y = screenY - popupHeight / 2;
    } else if (screenY - popupHeight / 2 < 0) {
      y = 10;
    } else {
      y = window.innerHeight - popupHeight - 10;
    }
    return { x, y };
  }, []);

  const handlePlaceClick = useCallback((place) => {
    setPopupPos(getPopupPosition(place.lat, place.lon));
    setSelectedPlace(place);
  }, [getPopupPosition]);

  const handleAirportClick = useCallback((airport) => {
    setPopupPos(getPopupPosition(airport.lat, airport.lon));
    setSelectedAirport(airport);
  }, [getPopupPosition]);

  const closeAllPopups = useCallback(() => {
    setSelectedPlace(null);
    setSelectedAirport(null);
  }, []);

  useEffect(() => {
    fetch('/jamaica-parishes.geojson')
      .then(r => r.json())
      .then(setGeojson)
      .catch(console.error);
    fetchAirports()
      .then(list => setAirports(list.map(mapAirport)))
      .catch(console.error);
    // Load always-on category places (lightweight: id, name, category, lat, lon)
    Promise.all(ALWAYS_ON_CATEGORIES.map(cat => fetchAllPlaces(cat)))
      .then(results => setAlwaysOnPlaces(results.flat()))
      .catch(console.error);
  }, []);

  // Reset selection when parish changes
  useEffect(() => {
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

  // Always-on markers: show when zoomed in, whether or not a parish is selected
  // When a parish IS selected, filter out duplicates already in parishPlaces
  const visibleAlwaysOn = useMemo(() => {
    if (currentZoom < ALWAYS_ON_MIN_ZOOM) return [];
    if (!alwaysOnPlaces.length) return [];
    if (activeSlug && parishPlaces && parishPlaces.length) {
      // Exclude places already shown as parish markers
      const parishIds = new Set(parishPlaces.map(p => p.id));
      return alwaysOnPlaces.filter(p => !parishIds.has(p.id));
    }
    return alwaysOnPlaces;
  }, [currentZoom, alwaysOnPlaces, activeSlug, parishPlaces]);

  const handleZoomChange = useCallback((zoom) => {
    setCurrentZoom(zoom);
  }, []);

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
            {geojson && (
              <select
                className="parish-select-dropdown"
                value=""
                onChange={(e) => { if (e.target.value) onSelect(e.target.value); }}
              >
                <option value="">Select a Parish...</option>
                {Object.entries(nameToSlug)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([name, slug]) => (
                    <option key={slug} value={slug}>{name}</option>
                  ))}
              </select>
            )}
          </div>
        )}

        {/* Flight tracking toggle */}
        <button
          className={`flight-toggle-btn${showFlights ? ' flight-toggle-active' : ''}`}
          onClick={() => setShowFlights(prev => !prev)}
          title={showFlights ? 'Hide live flights' : 'Show live flights'}
        >
          ✈ Live Flights {showFlights ? 'ON' : 'OFF'}
        </button>

        {/* Zoom level indicator */}
        {activeSlug && (
          <div className="zoom-level-control">
            <span className="zoom-level-label">Zoom</span>
            <span className="zoom-level-value">{currentZoom}</span>
            <button className="zoom-level-btn" onClick={() => mapRef.current && mapRef.current.zoomIn()} title="Zoom in">+</button>
            <button className="zoom-level-btn" onClick={() => mapRef.current && mapRef.current.zoomOut()} title="Zoom out">−</button>
          </div>
        )}

        {/* Category filters when parish is selected */}
        {activeSlug && availableCategories.length > 0 && (() => {
          const prominent = ['hotel', 'guest_house', 'resort', 'beach', 'car_rental', 'nightlife'];
          const prominentCats = prominent.filter(c => availableCategories.some(a => a.category === c));
          const otherCats = availableCategories.filter(a => !prominent.includes(a.category));
          const activeCat = activeCategories.size === 1 ? [...activeCategories][0] : '';
          return (
            <div className="zoom-filters">
              <button
                className={`category-btn ${activeCategories.size === 0 ? 'active' : ''}`}
                onClick={() => setActiveCategories(new Set())}
              >
                All ({parishPlaces ? parishPlaces.length : 0})
              </button>
              {prominentCats.map(cat => {
                const style = categoryStyles[cat] || { color: '#fff', label: cat };
                const info = availableCategories.find(a => a.category === cat);
                const isActive = activeCategories.has(cat);
                return (
                  <button
                    key={cat}
                    className={`category-btn category-btn-prominent ${isActive ? 'active' : ''}`}
                    style={{ '--cat-color': style.color }}
                    onClick={() => setActiveCategories(isActive ? new Set() : new Set([cat]))}
                  >
                    <span className="cat-dot" />
                    {style.label} ({info.count})
                  </button>
                );
              })}
              {otherCats.length > 0 && (
                <select
                  className="category-more-select"
                  value={prominent.includes(activeCat) ? '' : activeCat}
                  onChange={(e) => {
                    const val = e.target.value;
                    setActiveCategories(val ? new Set([val]) : new Set());
                  }}
                >
                  <option value="">More categories...</option>
                  {otherCats.map(({ category, count }) => {
                    const style = categoryStyles[category] || { color: '#fff', label: category };
                    return (
                      <option key={category} value={category}>
                        {style.icon} {style.label} ({count})
                      </option>
                    );
                  })}
                </select>
              )}
            </div>
          );
        })()}
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

          <MapRefExporter mapRef={mapRef} />
          <ClosePopupOnMove onClose={closeAllPopups} />
          <ZoomTracker onZoomChange={handleZoomChange} />
          <FlyToBounds bounds={activeBounds} activeSlug={activeSlug} />
          <FlyToPlace place={focusPlace} />

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
                click: () => handleAirportClick(ap),
              }}
            >
              <Tooltip direction="top" offset={[0, -16]} className="airport-leaflet-tooltip">
                ✈ {ap.shortName} ({ap.code})
              </Tooltip>
            </Marker>
          ))}

          {/* Always-on category markers (visible when zoomed in) */}
          {visibleAlwaysOn.map(p => {
            const style = categoryStyles[p.category] || { color: '#fff', label: p.category, icon: '📍' };
            const icon = categoryIcons[p.category] || defaultPlaceIcon;
            return (
              <Marker
                key={`ao-${p.id}`}
                position={[p.lat, p.lon]}
                icon={icon}
                eventHandlers={{
                  click: () => handlePlaceClick(p),
                }}
              >
                <Tooltip direction="top" offset={[0, -14]} className="place-leaflet-tooltip">
                  <strong>{p.name}</strong><br />
                  <span style={{ fontSize: '0.75rem', color: '#7a9cc6' }}>{style.label}</span>
                </Tooltip>
              </Marker>
            );
          })}

          {/* Place markers when a parish is selected */}
          {activeSlug && filteredPlaces.map(p => {
            const style = categoryStyles[p.category] || { color: '#fff', label: p.category, icon: '📍' };
            const isHighlighted = highlightedPlace && highlightedPlace.id === p.id;
            const isFocused = focusPlace && focusPlace.id === p.id;
            const icon = isFocused
              ? buildFocusIcon(style.icon, style.color)
              : isHighlighted
              ? (categoryIconsHighlight[p.category] || defaultHighlightIcon)
              : (categoryIcons[p.category] || defaultPlaceIcon);
            return (
              <Marker
                key={isFocused ? `${p.id}-focus-${focusKey}` : p.id}
                position={[p.lat, p.lon]}
                icon={icon}
                eventHandlers={{
                  click: () => handlePlaceClick(p),
                }}
              >
                <Tooltip direction="top" offset={[0, -14]} className="place-leaflet-tooltip">
                  <strong>{p.name}</strong><br />
                  <span style={{ fontSize: '0.75rem', color: '#7a9cc6' }}>{style.label}</span>
                </Tooltip>
              </Marker>
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
                  if (full) handlePlaceClick(full);
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -42]} permanent className="highlight-leaflet-tooltip">
                {highlightedPlace.name}
              </Tooltip>
            </Marker>
          )}

          {/* Live flight tracking */}
          <FlightTracker visible={showFlights} />
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
          anchorPos={popupPos}
        />
      )}

      {/* Airport detail popup */}
      {selectedAirport && (
        <AirportPopup
          airport={selectedAirport}
          onClose={() => setSelectedAirport(null)}
          anchorPos={popupPos}
        />
      )}
    </section>
  );
}

export default MapSection;
