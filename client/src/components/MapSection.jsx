import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { fetchCategories } from '../api/parishes';
import PlacePopup from './PlacePopup';
import ParishZoomView from './ParishZoomView';

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
  tourist_attraction: { color: '#ff5722', label: 'Attractions' },
  landmark: { color: '#9c27b0', label: 'Landmarks' },
  restaurant: { color: '#ff9800', label: 'Restaurants' },
  cafe: { color: '#795548', label: 'Cafes' },
  hotel: { color: '#2196f3', label: 'Hotels' },
  hospital: { color: '#f44336', label: 'Hospitals' },
  school: { color: '#607d8b', label: 'Schools' },
  beach: { color: '#00bcd4', label: 'Beaches' },
  place_of_worship: { color: '#e91e63', label: 'Worship' },
  bank: { color: '#4caf50', label: 'Banks' },
  gas_station: { color: '#ff5722', label: 'Gas Stations' },
  park: { color: '#8bc34a', label: 'Parks' },
  nightlife: { color: '#ce93d8', label: 'Nightlife' },
  shopping: { color: '#ffc107', label: 'Shopping' },
};

const SVG_WIDTH = 1000;
const SVG_HEIGHT = 450;
const PADDING = 30;

function projectCoords(features) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const feature of features) {
    const coords = feature.geometry.type === 'MultiPolygon'
      ? feature.geometry.coordinates.flat(1)
      : feature.geometry.coordinates;
    for (const ring of coords) {
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  const lonRange = maxLon - minLon;
  const latRange = maxLat - minLat;
  const usableW = SVG_WIDTH - PADDING * 2;
  const usableH = SVG_HEIGHT - PADDING * 2;
  const scale = Math.min(usableW / lonRange, usableH / latRange);
  const offsetX = PADDING + (usableW - lonRange * scale) / 2;
  const offsetY = PADDING + (usableH - latRange * scale) / 2;

  function project(lon, lat) {
    const x = (lon - minLon) * scale + offsetX;
    const y = (maxLat - lat) * scale + offsetY;
    return [x, y];
  }
  return { project };
}

function coordsToPath(rings, project) {
  return rings.map(ring => {
    const points = ring.map(([lon, lat]) => {
      const [x, y] = project(lon, lat);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M${points.join('L')}Z`;
  }).join(' ');
}

function centroid(rings, project) {
  let totalX = 0, totalY = 0, count = 0;
  for (const [lon, lat] of rings[0]) {
    const [x, y] = project(lon, lat);
    totalX += x;
    totalY += y;
    count++;
  }
  return { x: totalX / count, y: totalY / count };
}

function MapSection({ activeSlug, onSelect, parishPlaces }) {
  const [geojson, setGeojson] = useState(null);
  const [activeCategories, setActiveCategories] = useState(new Set());
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [tooltip, setTooltip] = useState({ visible: false, text: '', x: 0, y: 0 });
  const [placeTooltip, setPlaceTooltip] = useState({ visible: false, place: null, x: 0, y: 0 });
  const containerRef = useRef(null);

  useEffect(() => {
    fetch('/jamaica-parishes.geojson')
      .then(r => r.json())
      .then(setGeojson)
      .catch(console.error);
  }, []);

  // Reset filters and close popup when parish changes
  useEffect(() => {
    setActiveCategories(new Set());
    setSelectedPlace(null);
  }, [activeSlug]);

  const { parishPaths, project } = useMemo(() => {
    if (!geojson) return { parishPaths: [], project: null };
    const { project } = projectCoords(geojson.features);
    const parishPaths = geojson.features.map(feature => {
      const name = feature.properties.shapeName;
      const slug = nameToSlug[name];
      const rings = feature.geometry.type === 'MultiPolygon'
        ? feature.geometry.coordinates.flat(1)
        : feature.geometry.coordinates;
      const d = coordsToPath(rings, project);
      const center = centroid(rings, project);
      return { slug, name, d, center, color: parishColors[slug] || '#388e3c', feature };
    });
    // Sort so smaller parishes (like Kingston) render last (on top)
    // Kingston must render after St. Andrew which surrounds it
    parishPaths.sort((a, b) => {
      if (a.slug === 'kingston') return 1;
      if (b.slug === 'kingston') return -1;
      return 0;
    });
    return { parishPaths, project };
  }, [geojson]);

  // Build place markers from the selected parish's places
  const { placeMarkers, availableCategories } = useMemo(() => {
    if (!project || !parishPlaces || !parishPlaces.length) {
      return { placeMarkers: [], availableCategories: [] };
    }

    // Count categories available in this parish
    const catCounts = {};
    for (const p of parishPlaces) {
      catCounts[p.category] = (catCounts[p.category] || 0) + 1;
    }
    const availableCategories = Object.entries(catCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => ({ category: cat, count }));

    const filtered = activeCategories.size === 0
      ? parishPlaces
      : parishPlaces.filter(p => activeCategories.has(p.category));

    const placeMarkers = filtered.map(p => {
      const [x, y] = project(p.lon, p.lat);
      const style = categoryStyles[p.category] || { color: '#ffffff' };
      return { ...p, x, y, markerColor: style.color };
    });

    return { placeMarkers, availableCategories };
  }, [parishPlaces, project, activeCategories]);

  const activeParish = useMemo(() => {
    if (!activeSlug) return null;
    return parishPaths.find(p => p.slug === activeSlug) || null;
  }, [activeSlug, parishPaths]);

  const toggleCategory = useCallback((cat) => {
    setActiveCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const handleHoverStart = (name, e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setTooltip({
      visible: true, text: name,
      x: e.clientX - rect.left + 12,
      y: e.clientY - rect.top - 35,
    });
  };

  const handleHoverEnd = () => {
    setTooltip(prev => ({ ...prev, visible: false }));
  };

  const handlePlaceHover = (place, e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setPlaceTooltip({
      visible: true, place,
      x: e.clientX - rect.left + 12,
      y: e.clientY - rect.top - 40,
    });
  };

  const handlePlaceLeave = () => {
    setPlaceTooltip(prev => ({ ...prev, visible: false }));
  };

  // Show zoomed parish view when a parish is selected
  if (activeSlug && activeParish) {
    return (
      <section id="map-section">
        <ParishZoomView
          feature={activeParish.feature}
          parishName={activeParish.name}
          parishSlug={activeParish.slug}
          parishColor={activeParish.color}
          places={parishPlaces || []}
          onClose={() => onSelect(null)}
        />
      </section>
    );
  }

  return (
    <section id="map-section">
      <div className="map-header">
        <h1>Jamaica</h1>
        <p className="subtitle">Click a parish to explore</p>
      </div>

      <div id="map-container" ref={containerRef}>
        <div
          id="parish-tooltip"
          style={{
            opacity: tooltip.visible ? 1 : 0,
            left: tooltip.x + 'px',
            top: tooltip.y + 'px',
          }}
        >
          {tooltip.text}
        </div>
        <svg id="jamaica-map" viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} xmlns="http://www.w3.org/2000/svg">
          {parishPaths.map(p => (
            <path
              key={p.slug}
              className={`parish ${activeSlug === p.slug ? 'active' : ''}`}
              d={p.d}
              fill={p.color}
              onClick={() => onSelect(p.slug)}
              onMouseEnter={(e) => handleHoverStart(p.name, e)}
              onMouseMove={(e) => handleHoverStart(p.name, e)}
              onMouseLeave={handleHoverEnd}
            />
          ))}
          <g fontSize="10" fill="#c0d8c0" textAnchor="middle" pointerEvents="none" fontWeight="500" opacity="0.8">
            {parishPaths.map(p => (
              <text key={p.slug} x={p.center.x} y={p.center.y}>{p.name}</text>
            ))}
          </g>
        </svg>
      </div>
    </section>
  );
}

export default MapSection;
