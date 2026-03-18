import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from 'react';
import { MapContainer, TileLayer, GeoJSON, Marker, Tooltip, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default icon path issue with bundlers (Vite/Webpack)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

import union from '@turf/union';
import buffer from '@turf/buffer';
import { fetchAirports, fetchAllPlaces } from '../api/parishes';
import { fetchWeatherIsland, fetchWavesIsland } from '../api/weather';
import { mapAirport } from '../data/airports';
import { PORTS } from '../data/ports';
import { fetchVessels } from '../api/vessels';
import { fetchPortCruises } from '../api/portCruises';
import PlacePopup from './PlacePopup';
import AirportPopup from './AirportPopup';
import PortPopup from './PortPopup';
import FlightTracker from './FlightTracker';

// "Always on" categories — visible on map when zoomed in, no parish selection needed
const ALWAYS_ON_CATEGORIES = ['hotel', 'resort', 'guest_house', 'restaurant', 'beach'];
const ALWAYS_ON_MIN_ZOOM = 10; // Show when zoom >= this level

// Weather view: when on, show only airports + weather (temp, wind, cloud) at zoom 9–11, no place icons
const WEATHER_ZOOM_MIN = 9;
const WEATHER_ZOOM_MAX = 11;
// Wave layer: same zoom range as weather so they can be viewed together
const WAVE_ZOOM_MIN = 9;
const WAVE_ZOOM_MAX = 11;

const nameToSlug = {
  "Hanover": "hanover", "Westmoreland": "westmoreland",
  "Saint James": "st-james", "Trelawny": "trelawny",
  "Saint Ann": "st-ann", "Saint Elizabeth": "st-elizabeth",
  "Manchester": "manchester", "Clarendon": "clarendon",
  "Saint Mary": "st-mary", "Saint Catherine": "st-catherine",
  "Saint Andrew": "st-andrew", "Kingston": "kingston",
  "Saint Thomas": "st-thomas", "Portland": "portland",
};
const slugToName = Object.fromEntries(Object.entries(nameToSlug).map(([n, s]) => [s, n]));

// Parishes where weather icons need a small inland shift so they stay over land and don't sit under wave icons
const NORTH_COAST_PARISH_SLUGS = new Set(['st-james', 'trelawny', 'st-ann', 'st-mary', 'portland']); // nudge south (inland)
const SOUTH_COAST_PARISH_SLUGS = new Set(['westmoreland', 'st-elizabeth', 'clarendon', 'st-catherine']); // nudge north (inland)

// Map each marine wave point id to the parish slug whose shoreline it represents
const WAVE_POINT_TO_PARISH = {
  'negril': 'westmoreland',
  'savanna-la-mar': 'westmoreland',
  // Lucea (Hanover) reuses Negril marine conditions so Hanover has a visible shoreline wave icon
  'lucea': 'hanover',
  // Alligator Pond wave point belongs to Manchester's short south coast
  'alligator-pond-manchester': 'manchester',
  'montego-bay': 'st-james',
  'falmouth': 'trelawny',
  'ocho-rios': 'st-ann',
  'port-maria': 'st-mary',
  'port-antonio': 'portland',
  'morant-bay': 'st-thomas',
  'kingston': 'kingston',
  'old-harbour': 'st-catherine',
  'rocky-point': 'clarendon',
  'black-river': 'st-elizabeth',
  'treasure-beach': 'st-elizabeth',
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
   port: { color: '#00acc1', label: 'Ports', icon: '⚓' },
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

function buildWeatherIcon(temp) {
  const t = temp != null ? Math.round(Number(temp)) : '—';
  return L.divIcon({
    className: 'weather-leaflet-icon',
    html: `<div class="weather-icon-inner"><span class="weather-temp">${t}°</span></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

const vesselIcon = L.divIcon({
  className: 'vessel-leaflet-icon',
  html: '<div class="vessel-icon-inner">🛳</div>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

const cruisePortIcon = L.divIcon({
  className: 'port-leaflet-icon port-cruise-icon',
  html: '<div class="port-icon-inner port-icon-cruise">🛳</div>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

const marinaPortIcon = L.divIcon({
  className: 'port-leaflet-icon port-marina-icon',
  html: '<div class="port-icon-inner port-icon-marina">⚓</div>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

// Parse ETA text like "17 Mar 2026 - 09:30" (CruiseDig / CruiseMapper) into a Date
function parseCruiseEtaToDate(etaLocalText) {
  if (!etaLocalText || typeof etaLocalText !== 'string') return null;
  const cleaned = etaLocalText.replace('–', '-').trim();
  const parts = cleaned.split('-').map((s) => s.trim());
  if (!parts[0]) return null;
  const candidate = parts[1] ? `${parts[0]} ${parts[1]}` : parts[0];
  const d = new Date(candidate);
  return Number.isNaN(d.getTime()) ? null : d;
}

function buildPortStatusIcon(expectedCount, inPortCount) {
  return L.divIcon({
    className: 'port-status-leaflet-icon',
    html: `<div class="port-status-inner">
      <span class="port-status-seg port-status-expected">🛬 ${expectedCount}</span>
      <span class="port-status-sep">|</span>
      <span class="port-status-seg port-status-inport">🛥 ${inPortCount}</span>
    </div>`,
    iconSize: [46, 22],
    iconAnchor: [23, 28], // anchor slightly below so CSS can nudge it above the port icon
  });
}

function buildWeatherUnavailableIcon() {
  return L.divIcon({
    className: 'weather-leaflet-icon weather-unavailable-icon',
    html: '<div class="weather-icon-inner weather-icon-inner-unavailable"><span class="weather-temp">—°</span></div>',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

// Wind arrow: direction = meteorological (from), arrow points where wind blows. Size 48 at zoom 9.
function buildWindArrowIcon(windDirection, windSpeed) {
  const deg = Number(windDirection) || 0;
  const speed = Number(windSpeed) || 0;
  const rot = (deg + 180) % 360; // arrow points downwind
  const len = Math.min(26, Math.max(12, 12 + (speed / 30) * 14));
  const size = 48;
  const half = size / 2;
  return L.divIcon({
    className: 'wind-leaflet-icon',
    html: `<div class="wind-arrow-wrap" style="--rot:${rot}deg">
      <svg class="wind-arrow-svg" viewBox="0 0 48 48" width="${size}" height="${size}">
        <line x1="${half}" y1="40" x2="${half}" y2="${48 - len}" stroke="rgba(100,180,255,0.98)" stroke-width="3" stroke-linecap="round"/>
        <polygon points="${half},6 10,20 ${half},16 38,20" fill="rgba(100,180,255,0.98)"/>
      </svg>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [half, half],
  });
}

// WMO weather codes that indicate rain (drizzle, rain, showers, thunderstorm)
function isRaining(weatherCode) {
  if (weatherCode == null) return false;
  const code = Number(weatherCode);
  return (
    (code >= 51 && code <= 55) ||   // drizzle
    (code >= 61 && code <= 67) ||   // rain / freezing rain
    (code >= 80 && code <= 82) ||   // showers
    (code >= 95 && code <= 99)      // thunderstorm
  );
}

// WMO weather codes for clear / mainly clear sky (sunshine)
function isClearSky(weatherCode) {
  if (weatherCode == null) return false;
  const code = Number(weatherCode);
  return code === 0 || code === 1; // 0 = Clear, 1 = Mainly clear
}

// Decide how dense / strong clouds should appear for a parish, based on the
// forecast code and whether a sun glyph will be shown.
function getCloudMode(weatherCode) {
  if (weatherCode == null) return 'normal';
  const code = Number(weatherCode);
  if (isRaining(code)) return 'rain';
  if (isClearSky(code)) return 'light';
  // Overcast / foggy-style codes – emphasise heavy cloud cover
  if (code === 2 || code === 3 || code === 45 || code === 48) return 'overcast';
  return 'normal';
}

// Sun icon for clear / mainly clear sky
function buildSunIcon() {
  const size = 52;
  return L.divIcon({
    className: 'sun-leaflet-icon',
    html: `<div class="sun-icon-inner" aria-hidden="true"><span class="sun-emoji">☀</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// Rain indicator icon for parishes where it's raining
function buildRainIcon() {
  const size = 56;
  return L.divIcon({
    className: 'rain-leaflet-icon',
    html: `<div class="rain-icon-inner" aria-hidden="true"><span class="rain-drops">🌧</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// Wave pattern icon: SVG wave symbol, rotated to direction waves move
const WAVE_SVG = (fill, stroke) => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" class="wave-svg" aria-hidden="true">
  <path fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M0 10 Q 6 4, 12 10 Q 18 16, 24 10" />
  <path fill="none" stroke="${fill}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" d="M0 14 Q 6 20, 12 14 Q 18 8, 24 14" />
</svg>`;

function buildWaveIcon(waveHeightM, waveDirectionDeg) {
  const h = waveHeightM != null && Number.isFinite(waveHeightM) ? waveHeightM.toFixed(1) : '—';
  // API: direction FROM which waves come; icon shows direction TO which they move
  const rotation = (Number(waveDirectionDeg) || 0) + 180;
  const size = 48;
  const fill = '#64b5f6';
  const stroke = '#42a5f5';
  return L.divIcon({
    className: 'wave-leaflet-icon',
    html: `<div class="wave-icon-inner" style="transform:rotate(${rotation}deg)">
      <span class="wave-svg-wrap">${WAVE_SVG(fill, stroke)}</span>
      <span class="wave-height">${h}m</span>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// Cloud: opacity from cloud cover (min 0.5 so always visible at zoom 9), drift direction from wind.
// Mode controls how \"strong\" the cloud looks visually:
// - 'light': subtle cloud for mainly clear
// - 'overcast': larger, denser cloud for overcast / fog
// - 'rain': very dense cloud used together with rain glyphs
function buildCloudIcon(cloudCover, windDirection, mode = 'normal') {
  let cover = Math.min(100, Math.max(0, Number(cloudCover) || 0));
  let size = 64;
  if (mode === 'light') {
    cover = Math.min(60, cover || 40);
    size = 56;
  } else if (mode === 'overcast') {
    cover = Math.max(cover, 90);
    size = 72;
  } else if (mode === 'rain') {
    cover = Math.max(cover, 96);
    size = 76;
  }
  const opacity = Math.max(0.5, cover / 100); // always visible
  const deg = (Number(windDirection) || 0) + 180;
  const rad = (deg * Math.PI) / 180;
  const moveX = (24 * Math.sin(rad)).toFixed(1);
  const moveY = (-24 * Math.cos(rad)).toFixed(1);
  return L.divIcon({
    className: 'cloud-leaflet-icon',
    html: `<div class="cloud-wrap" style="--cloud-opacity:${opacity};--move-x:${moveX}px;--move-y:${moveY}px;--cloud-size:${size}px">
      <span class="cloud-emoji" aria-hidden="true">☁</span>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

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

  // Create custom panes: mask (hide other countries) < parish < weather < markers
  useEffect(() => {
    if (!map.getPane('maskPane')) {
      const p = map.createPane('maskPane');
      p.style.zIndex = 250; // above tiles (200), below parish (300)
    }
    if (!map.getPane('parishPane')) {
      const pane = map.createPane('parishPane');
      pane.style.zIndex = 300; // below weather
    }
    if (!map.getPane('weatherPane')) {
      const wp = map.createPane('weatherPane');
      wp.style.zIndex = 460; // above parishes and waves so temp/weather always visible when overlapping wave icons
    }
    if (!map.getPane('wavePane')) {
      const wp = map.createPane('wavePane');
      wp.style.zIndex = 455; // below weather so parish temp is not hidden under wave icon
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

function JamaicaMaskLayer({ maskData }) {
  const map = useMap();
  useEffect(() => {
    if (!maskData) return;
    if (!map.getPane('maskPane')) {
      const p = map.createPane('maskPane');
      p.style.zIndex = 250;
    }
    const layer = L.geoJSON(maskData, {
      style: () => ({
        pane: 'maskPane',
        fillColor: '#0d1f3c',
        fillOpacity: 1,
        weight: 0,
        interactive: false,
      }),
    });
    layer.addTo(map);
    return () => { map.removeLayer(layer); };
  }, [map, maskData]);
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

function MapSection({ activeSlug, onSelect, onAirportSelect, showFlights: showFlightsProp, onFlightsChange, parishPlaces, highlightedPlace, onClearHighlight, activeCategories, onCategoriesChange, focusPlace, focusKey, children }) {
  const [geojson, setGeojson] = useState(null);
  const [airports, setAirports] = useState([]);
  const [alwaysOnPlaces, setAlwaysOnPlaces] = useState([]);
  const [currentZoom, setCurrentZoom] = useState(11);
  const showFlights = showFlightsProp !== undefined ? showFlightsProp : true;
  const setShowFlights = onFlightsChange || (() => {});
  const [showWeatherView, setShowWeatherView] = useState(false); // when on: zoom 9–11 only airports + weather, no places
  const [islandWeather, setIslandWeather] = useState([]);
  const [showWavesView, setShowWavesView] = useState(false);
  const [islandWaves, setIslandWaves] = useState([]);
  const [showVessels, setShowVessels] = useState(false);
  const [vessels, setVessels] = useState([]);
  const liveDataOn = showFlights || showWeatherView || showWavesView || showVessels;
  const toggleAllLiveData = () => {
    if (liveDataOn) {
      setShowFlights(false);
      setShowWeatherView(false);
      setShowWavesView(false);
      setShowVessels(false);
    } else {
      setShowFlights(true);
      setShowWeatherView(true);
      setShowWavesView(true);
      setShowVessels(true);
    }
  };
  // Base map layer: one of standard OSM, or Thunderforest Transport / Landscape / Neighbourhood
  const [baseLayer, setBaseLayer] = useState('standard');
  const [portCruisesById, setPortCruisesById] = useState({});
  const setActiveCategories = onCategoriesChange;
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [selectedAirport, setSelectedAirport] = useState(null);
  const [selectedPort, setSelectedPort] = useState(null);
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

  const handlePortClick = useCallback((port) => {
    setPopupPos(getPopupPosition(port.lat, port.lon));
    setSelectedPort(port);

    // Ensure we have up-to-date cruise data for this port when the popup opens.
    // Even if the initial bulk fetch returned empty (or ran before backend fixes),
    // this per-port fetch will populate `portCruisesById[port.id]` so the popup
    // shows the correct upcoming calls.
    (async () => {
      try {
        const data = await fetchPortCruises(port.id);
        const list = Array.isArray(data?.cruises) ? data.cruises : [];
        setPortCruisesById(prev => ({ ...prev, [port.id]: list }));
      } catch {
        // leave existing data as-is on error
      }
    })();
  }, [getPopupPosition]);

  const handleAirportClick = useCallback((airport) => {
    if (onAirportSelect) onAirportSelect(airport);
  }, [onAirportSelect]);

  const closeAllPopups = useCallback(() => {
    setSelectedPlace(null);
    setSelectedAirport(null);
    setSelectedPort(null);
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

  // Pre-compute visual centres for each parish from GeoJSON so weather icons sit in the middle of each parish shape
  const parishCentersBySlug = useMemo(() => {
    if (!geojson || !geojson.features) return {};
    const centers = {};
    for (const feature of geojson.features) {
      const name = feature.properties?.shapeName;
      const slug = nameToSlug[name];
      if (!slug) continue;
      const layer = L.geoJSON(feature);
      const bounds = layer.getBounds();
      const center = bounds.getCenter();
      centers[slug] = { lat: center.lat, lon: center.lng };
    }
    return centers;
  }, [geojson]);

  // Compute canonical positions for all parish weather glyphs (temp, sun, cloud, wind, rain) so they are
  // consistently centred per parish and can be updated whenever islandWeather changes.
  const getParishWeatherGlyphPositions = useCallback((slug) => {
    const centre = parishCentersBySlug[slug];
    let baseLat = centre?.lat;
    let baseLon = centre?.lon;
    if (baseLat == null || baseLon == null) return null;

    // Small inland nudge for coastal parishes so the glyph cluster stays over land.
    if (NORTH_COAST_PARISH_SLUGS.has(slug)) baseLat -= 0.04;
    else if (SOUTH_COAST_PARISH_SLUGS.has(slug)) baseLat += 0.04;

    const offset = 0.06;
    return {
      temp: [baseLat, baseLon],                          // centre
      cloud: [baseLat + offset, baseLon],                // north
      wind: [baseLat - offset, baseLon + offset],        // south‑east
      rain: [baseLat + offset * 0.85, baseLon + offset], // north‑east
      sun: [baseLat + offset, baseLon - offset],         // north‑west
    };
  }, [parishCentersBySlug]);

  // Place wave glyphs at their actual marine coordinates so each glyph lines up with
  // the true coastal sample location within its parish.
  const getWaveGlyphPosition = useCallback((wave) => {
    return [wave.lat, wave.lon];
  }, []);

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

  // Weather layer: when Weather View is on, show at zoom 9–11 only
  const zoomRounded = Math.round(currentZoom);
  const showWeatherLayer = showWeatherView && zoomRounded >= WEATHER_ZOOM_MIN && zoomRounded <= WEATHER_ZOOM_MAX;
  const WEATHER_POLL_MS = 20 * 60 * 1000; // 20 minutes — refresh map weather when allowed

  // When weather view is on, fetch island weather and refresh every 20 min so map stays up to date
  useEffect(() => {
    if (!showWeatherView || zoomRounded < 8 || zoomRounded > 11) return;
    const refresh = () => {
      fetchWeatherIsland()
        .then(setIslandWeather)
        .catch(() => setIslandWeather([]));
    };
    refresh();
    const interval = setInterval(refresh, WEATHER_POLL_MS);
    return () => clearInterval(interval);
  }, [showWeatherView, zoomRounded]);

  // When waves view is on, fetch wave data and refresh every 20 min so map stays up to date
  const showWavesLayer = showWavesView && zoomRounded >= WAVE_ZOOM_MIN && zoomRounded <= WAVE_ZOOM_MAX;
  useEffect(() => {
    if (!showWavesView || zoomRounded < 8 || zoomRounded > 11) return;
    const refresh = () => {
      fetchWavesIsland()
        .then(setIslandWaves)
        .catch(() => setIslandWaves([]));
    };
    refresh();
    const interval = setInterval(refresh, WEATHER_POLL_MS);
    return () => clearInterval(interval);
  }, [showWavesView, zoomRounded]);
  const hasThunderforestKey = !!import.meta.env.VITE_THUNDERFOREST_API_KEY;
  // When any Thunderforest base layer is on, hide all items (clean map-only view)
  const thunderforestHidesItems = hasThunderforestKey && baseLayer !== 'standard';
  // When vessels layer is on, hide place icons and parish filters so ships stand out,
  // but still allow flights, weather, and waves to be viewed together with vessels.
  const vesselsHideItems = showVessels;
  // Hide place icons when weather view is on (only airports + weather at 9–11) or when a global-hiding layer is on
  const hidePlaceIcons =
    (showWeatherView && zoomRounded >= WEATHER_ZOOM_MIN && zoomRounded <= WEATHER_ZOOM_MAX) ||
    thunderforestHidesItems ||
    vesselsHideItems;

  // Poll vessels when the layer is visible (and Thunderforest layers are not hiding items)
  useEffect(() => {
    let timer;
    const active = showVessels && !thunderforestHidesItems;
    if (!active) {
      setVessels([]);
      return;
    }
    const load = () => {
      fetchVessels('all')
        .then(data => {
          if (!data || !Array.isArray(data.vessels)) {
            setVessels([]);
          } else {
            setVessels(data.vessels);
          }
        })
        .catch(() => setVessels([]));
    };
    load();
    timer = setInterval(load, 60000); // refresh every 60s while visible
    return () => { if (timer) clearInterval(timer); };
  }, [showVessels, thunderforestHidesItems]);

  // Load expected cruise counts per port when vessels view is on
  useEffect(() => {
    let cancelled = false;
    if (!showVessels) return;
    (async () => {
      try {
        const entries = await Promise.all(
          PORTS.map(async (p) => {
            try {
              const data = await fetchPortCruises(p.id);
              const list = Array.isArray(data.cruises) ? data.cruises : [];
              return [p.id, list];
            } catch {
              return [p.id, []];
            }
          }),
        );
        if (!cancelled) setPortCruisesById(Object.fromEntries(entries));
      } catch {
        if (!cancelled) setPortCruisesById({});
      }
    })();
    return () => { cancelled = true; };
  }, [showVessels]);

  // Available categories for filter bar
  const PORT_PARISH_SLUGS = new Set(['st-james', 'trelawny', 'st-ann', 'portland', 'kingston']);

  const availableCategories = useMemo(() => {
    if (!parishPlaces || !parishPlaces.length) {
      // Even when there are no place records, expose 'port' for parishes that have a cruise port
      if (activeSlug && PORT_PARISH_SLUGS.has(activeSlug)) {
        return [{ category: 'port', count: 1 }];
      }
      return [];
    }
    const catCounts = {};
    for (const p of parishPlaces) {
      catCounts[p.category] = (catCounts[p.category] || 0) + 1;
    }
    const base = Object.entries(catCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => ({ category: cat, count }));
    // Add synthetic 'port' category when this parish has a cruise port
    if (activeSlug && PORT_PARISH_SLUGS.has(activeSlug) && !base.some(c => c.category === 'port')) {
      base.push({ category: 'port', count: 1 });
    }
    return base;
  }, [parishPlaces, activeSlug]);

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

  // Mask: cover everything outside Jamaica so only the island is visible (no other countries).
  // Hole is buffered slightly outward (~2 km) so the blue never overlaps the tile layer at the coast.
  const jamaicaMask = useMemo(() => {
    if (!geojson || !geojson.features || geojson.features.length < 2) return null;
    try {
      const jamaica = union(geojson);
      if (!jamaica || !jamaica.geometry) return null;
      const buffered = buffer(jamaica, 2.5, { units: 'kilometers' });
      if (!buffered || !buffered.geometry) return null;
      const coords = buffered.geometry.coordinates;
      const exteriorRing = buffered.geometry.type === 'Polygon'
        ? coords[0]
        : coords[0][0];
      if (!exteriorRing || exteriorRing.length < 3) return null;
      // GeoJSON hole must be clockwise; exterior is counter-clockwise. Reverse for hole.
      const hole = [...exteriorRing].reverse();
      const outer = [[-95, 14], [-95, 22], [-72, 22], [-72, 14], [-95, 14]];
      return {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [outer, hole] }
      };
    } catch (_) {
      return null;
    }
  }, [geojson]);

  return (
    <>
      <div className="map-top-strip">
        <div className="map-top-grid">
          {/* Cell 1: Parish select or Back + title */}
          {activeSlug ? (
            <div className="map-top-cell parish-cell parish-zoom-header">
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
            <div className="map-top-cell parish-cell">
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

          {/* Cell 2: Zoom */}
          <div className="map-top-cell zoom-cell zoom-level-control">
            <span className="zoom-level-label">Zoom</span>
            <span className="zoom-level-value">{currentZoom}</span>
            <button className="zoom-level-btn" onClick={() => mapRef.current && mapRef.current.zoomIn()} title="Zoom in">+</button>
            <button className="zoom-level-btn" onClick={() => mapRef.current && mapRef.current.zoomOut()} title="Zoom out">−</button>
          </div>

          {/* Cell 3: Flight, Weather, Waves, Map layer */}
          <div className="map-top-cell toggles-cell">
            <button
              className={`flight-toggle-btn${liveDataOn ? ' flight-toggle-active' : ''}`}
              onClick={toggleAllLiveData}
              title={liveDataOn ? 'Hide all live data (flights, weather, waves, vessels)' : 'Show all live data (flights, weather, waves, vessels)'}
            >
              ✈ Live Data <span className="toggle-value">{liveDataOn ? 'ON' : 'OFF'}</span>
            </button>
            {hasThunderforestKey ? (
              <select
                className="base-layer-select parish-select-dropdown"
                value={baseLayer}
                onChange={(e) => setBaseLayer(e.target.value)}
                title="Map base layer: choose Standard to turn layers off, or pick Transport / Landscape / Neighbourhood to turn that layer on"
              >
                <option value="standard">Standard map (layers off)</option>
                <option value="transport">🚌 Transport (on)</option>
                <option value="landscape">🏔 Landscape (on)</option>
                <option value="neighbourhood">🏘 Neighbourhood (on)</option>
              </select>
            ) : (
              <span className="base-layer-placeholder" title="Set VITE_THUNDERFOREST_API_KEY in client/.env for Transport, Landscape, Neighbourhood layers">
                Map layer (API key needed)
              </span>
            )}
          </div>

          {/* Cell 4: Search bar */}
          <div className="map-top-cell search-cell">
            {children}
          </div>
        </div>
      </div>

      <section id="map-section">
      {/* Category filters when parish is selected — hidden when global-hiding layers are on */}
      {!hidePlaceIcons && !vesselsHideItems && activeSlug && availableCategories.length > 0 && (
      <div className="map-top-bar">
        {(() => {
          const prominent = ['hotel', 'guest_house', 'resort', 'beach', 'port', 'car_rental', 'nightlife'];
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
                const style = { ...(categoryStyles[cat] || { color: '#fff', label: cat }) };
                if (cat === 'port') style.icon = '⚓';
                const info = availableCategories.find(a => a.category === cat);
                const isActive = activeCategories.has(cat);
                return (
                  <button
                    key={cat}
                    className={`category-btn category-btn-prominent ${isActive ? 'active' : ''}`}
                    style={{ '--cat-color': style.color }}
                    onClick={() => setActiveCategories(isActive ? new Set() : new Set([cat]))}
                  >
                    <span className="cat-dot">{style.icon}</span>
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
                    const style = { ...(categoryStyles[category] || { color: '#fff', label: category }) };
                    if (category === 'port') style.icon = '⚓';
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
      )}

      {/* Leaflet Map */}
      <div id="map-container">
        <MapContainer
          center={JAMAICA_CENTER}
          zoom={11}
          minZoom={9}
          maxZoom={18}
          maxBounds={MAX_BOUNDS}
          maxBoundsViscosity={1.0}
          style={{ width: '100%', height: '100%' }}
          zoomControl={false}
        >
          {hasThunderforestKey && baseLayer === 'transport' ? (
            <TileLayer
              key="base-transport"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles &copy; <a href="https://www.thunderforest.com">Thunderforest</a>'
              url={`https://api.thunderforest.com/transport/{z}/{x}/{y}.png?apikey=${import.meta.env.VITE_THUNDERFOREST_API_KEY}`}
            />
          ) : hasThunderforestKey && baseLayer === 'landscape' ? (
            <TileLayer
              key="base-landscape"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles &copy; <a href="https://www.thunderforest.com">Thunderforest</a>'
              url={`https://api.thunderforest.com/landscape/{z}/{x}/{y}.png?apikey=${import.meta.env.VITE_THUNDERFOREST_API_KEY}`}
            />
          ) : hasThunderforestKey && baseLayer === 'neighbourhood' ? (
            <TileLayer
              key="base-neighbourhood"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles &copy; <a href="https://www.thunderforest.com">Thunderforest</a>'
              url={`https://api.thunderforest.com/neighbourhood/{z}/{x}/{y}.png?apikey=${import.meta.env.VITE_THUNDERFOREST_API_KEY}`}
            />
          ) : (
            <TileLayer
              key="base-osm"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          )}

          {/* Mask: only Jamaica visible; everything else covered (added imperatively so pane is set) */}
          <JamaicaMaskLayer maskData={jamaicaMask} />

          <MapRefExporter mapRef={mapRef} />
          <ClosePopupOnMove onClose={closeAllPopups} />
          <ZoomTracker onZoomChange={handleZoomChange} />
          <FlyToBounds bounds={activeBounds} activeSlug={activeSlug} />
          <FlyToPlace place={focusPlace} />

          {/* Parish boundaries — hidden when Transport layer is on */}
          {geojson && !thunderforestHidesItems && (
            <GeoJSON
              key={geoJsonKey}
              ref={geoJsonRef}
              data={geojson}
              style={parishStyle}
              onEachFeature={onEachFeature}
            />
          )}

          {/* Weather at zoom 9–11: all parish glyphs (temp, sun, cloud, wind, rain) are laid out from a single centred anchor; hidden when Transport is on */}
          {!thunderforestHidesItems && showWeatherLayer && islandWeather.map((w) => {
            const positions = getParishWeatherGlyphPositions(w.slug);
            if (!positions) return null;
            const { temp: tempPos, cloud: cloudPos, wind: windPos, rain: rainPos, sun: sunPos } = positions;
            const unavailable = !!w.error;
            const raining = !unavailable && isRaining(w.weatherCode);
            const clearSky = !unavailable && isClearSky(w.weatherCode);
            const cloudMode = !unavailable ? getCloudMode(w.weatherCode) : 'normal';
            const parishName = slugToName[w.slug] || w.slug;

            return (
              <Fragment key={`weather-${w.slug}`}>
                {/* Sun icon when clear / mainly clear */}
                {clearSky && (
                  <Marker
                    position={sunPos}
                    icon={buildSunIcon()}
                    zIndexOffset={503}
                    pane="weatherPane"
                  >
                    <Tooltip direction="top" offset={[0, -14]} className="weather-leaflet-tooltip">
                      <strong>{parishName}</strong>
                      <br />
                      <span style={{ color: '#ffb74d' }}>☀ {w.description || 'Clear'}</span>
                    </Tooltip>
                  </Marker>
                )}
                {/* Rain overlay + icon when parish has rain */}
                {raining && (
                  <>
                    <Circle
                      center={[w.lat, w.lon]}
                      radius={14000}
                      pathOptions={{
                        pane: 'weatherPane',
                        className: 'rain-overlay-circle',
                        fillColor: '#5c9fd4',
                        fillOpacity: 0.22,
                        color: 'transparent',
                        weight: 0,
                        interactive: false,
                      }}
                    />
                    <Marker
                      position={rainPos}
                      icon={buildRainIcon()}
                      zIndexOffset={502}
                      pane="weatherPane"
                    >
                      <Tooltip direction="top" offset={[0, -14]} className="weather-leaflet-tooltip">
                        <strong>{parishName}</strong>
                        <br />
                        <span style={{ color: '#64b5f6' }}>🌧 {w.description || 'Rain'}</span>
                      </Tooltip>
                    </Marker>
                  </>
                )}
                {/* Cloud — north (skip when unavailable) */}
                {!unavailable && (
                  <Marker
                    position={cloudPos}
                    icon={buildCloudIcon(w.cloudCover ?? 0, w.windDirection ?? 0, cloudMode)}
                    zIndexOffset={500}
                    pane="weatherPane"
                  />
                )}
                {/* Wind — south‑east */}
                {!unavailable && (
                  <Marker
                    position={windPos}
                    icon={buildWindArrowIcon(w.windDirection ?? 0, w.windSpeed ?? 0)}
                    zIndexOffset={501}
                    pane="weatherPane"
                  />
                )}
                {/* Temperature — at parish centre */}
                <Marker
                  position={tempPos}
                  icon={unavailable ? buildWeatherUnavailableIcon() : buildWeatherIcon(w.temperature)}
                  zIndexOffset={600}
                  pane="weatherPane"
                >
                  <Tooltip direction="top" offset={[0, -18]} className="weather-leaflet-tooltip">
                    <strong>{parishName}</strong>
                    <br />
                    {unavailable ? (
                      <span style={{ color: '#90a4ae' }}>Weather unavailable · Next refresh within 20 min</span>
                    ) : (
                      <>
                        {w.temperature != null ? `${Math.round(w.temperature)}°C` : '—'} · {w.description || '—'}
                        <br />
                        <span style={{ fontSize: '0.75rem', color: '#7a9cc6' }}>
                          Humidity {w.humidity}% · Wind {w.windSpeed} km/h
                        </span>
                      </>
                    )}
                  </Tooltip>
                </Marker>
              </Fragment>
            );
          })}

          {/* Wave conditions at coastal points (zoom 9–11); each glyph kept close to the shoreline point for its parish area */}
          {!thunderforestHidesItems && showWavesLayer && islandWaves.map((w) => {
            const [wLat, wLon] = getWaveGlyphPosition(w);
            return (
              <Marker
                key={`wave-${w.id}`}
                position={[wLat, wLon]}
                icon={buildWaveIcon(w.waveHeight, w.waveDirection)}
                zIndexOffset={510}
                pane="wavePane"
              >
                <Tooltip direction="top" offset={[0, -12]} className="weather-leaflet-tooltip">
                  <strong>{w.name}</strong>
                  <br />
                  <span style={{ color: '#64b5f6' }}>
                    Wave height {w.waveHeight != null ? `${Number(w.waveHeight).toFixed(1)} m` : '—'}
                    {w.wavePeriod != null ? ` · Period ${Number(w.wavePeriod).toFixed(0)} s` : ''}
                  </span>
                  <br />
                  <span style={{ fontSize: '0.7rem', color: '#90a4ae' }}>
                    Arrow = direction waves are moving
                  </span>
                </Tooltip>
              </Marker>
            );
          })}

          {/* Airport markers — hidden when Transport layer is on */}
          {!thunderforestHidesItems && airports.map(ap => (
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

          {/* Major ports / piers and marinas — only when vessels layer is on (to keep context focused on maritime view) */}
          {!thunderforestHidesItems && showVessels && PORTS.map(p => {
            const isCruiseCapable = p.type === 'cruise' || p.type === 'cruise-cargo';
            const icon = isCruiseCapable ? cruisePortIcon : marinaPortIcon;
            const roleLabel = isCruiseCapable
              ? (p.type === 'cruise-cargo' ? 'Cruise & cargo port' : 'Cruise pier')
              : (p.type === 'harbor' ? 'Harbor / anchorage' : 'Marina (no cruise ships)');
            return (
              <Marker
                key={p.id}
                position={[p.lat, p.lon]}
                icon={icon}
                eventHandlers={{
                  click: () => handlePortClick(p),
                }}
              >
                <Tooltip direction="top" offset={[0, -14]} className="place-leaflet-tooltip">
                  <strong>{p.name}</strong><br />
                  <span style={{ fontSize: '0.75rem', color: '#7a9cc6' }}>
                    {p.city}{p.city ? ' · ' : ''}{roleLabel}
                  </span>
                </Tooltip>
              </Marker>
            );
          })}

          {/* Port status badges: expected vs in-port counts (upcoming this month only), only for cruise-capable ports */}
          {!thunderforestHidesItems && showVessels && PORTS.map(p => {
            const isCruiseCapable = p.type === 'cruise' || p.type === 'cruise-cargo';
            if (!isCruiseCapable) return null;
            const cruisesForPort = portCruisesById[p.id] || [];
            const now = new Date();
            const thisMonthUpcoming = cruisesForPort.filter(c => {
              const eta = parseCruiseEtaToDate(c.etaLocalText || c.eta_localText || c.eta_local_text);
              if (!eta) return false;
              return (
                eta.getFullYear() === now.getFullYear() &&
                eta.getMonth() === now.getMonth() &&
                eta >= now
              );
            });
            const expected = thisMonthUpcoming.length;
            const inPort = vessels.filter(v => {
              const dLat = v.lat - p.lat;
              const dLon = v.lon - p.lon;
              const distKm = Math.hypot(dLat * 111, dLon * 111 * Math.cos(p.lat * Math.PI / 180));
              return distKm <= 3;
            }).length;
            if (expected === 0 && inPort === 0) return null;
            return (
              <Marker
                key={`${p.id}-status`}
                position={[p.lat, p.lon]}
                icon={buildPortStatusIcon(expected, inPort)}
              >
                <Tooltip direction="top" offset={[0, -18]} className="airport-leaflet-tooltip">
                  <strong>{p.name}</strong>
                  <br />
                  <span style={{ fontSize: '0.75rem', color: '#b3e5fc' }}>Expected: {expected}</span>
                  <br />
                  <span style={{ fontSize: '0.75rem', color: '#80cbc4' }}>In port (AIS): {inPort}</span>
                </Tooltip>
              </Marker>
            );
          })}

          {/* Vessel markers — hidden when Thunderforest layers are on */}
          {!thunderforestHidesItems && showVessels && vessels.map(v => (
            <Marker
              key={v.mmsi}
              position={[v.lat, v.lon]}
              icon={vesselIcon}
              rotationAngle={v.heading || v.cog || 0}
              rotationOrigin="center"
            >
              <Tooltip direction="top" offset={[0, -14]} className="place-leaflet-tooltip">
                <strong>{v.name || `MMSI ${v.mmsi}`}</strong><br />
                <span style={{ fontSize: '0.75rem', color: '#7a9cc6' }}>
                  {v.shipType || 'Vessel'} · {v.sog != null ? `${v.sog.toFixed(1)} kn` : '—'}
                </span>
              </Tooltip>
            </Marker>
          ))}

          {/* Always-on category markers — hidden when Weather View is on at zoom 9–11 or Vessels is on */}
          {!hidePlaceIcons && !vesselsHideItems && visibleAlwaysOn.map(p => {
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

          {/* Place markers when a parish is selected — hidden when Weather View is on at zoom 9–11 or Vessels is on */}
          {!hidePlaceIcons && !vesselsHideItems && activeSlug && filteredPlaces.map(p => {
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

          {/* Highlighted place from search — hidden when Weather View is on at zoom 9–11 or Vessels is on */}
          {!hidePlaceIcons && !vesselsHideItems && highlightedPlace && activeSlug && (
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

          {/* Live flight tracking — hidden when Transport layer is on */}
          <FlightTracker visible={showFlights && !thunderforestHidesItems} onAirportSelect={onAirportSelect} airports={airports} />
        </MapContainer>
      </div>

      {/* Category legend when parish selected — hidden in Weather View and Vessels view */}
      {!hidePlaceIcons && !vesselsHideItems && activeSlug && availableCategories.length > 0 && (
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

      {/* Port detail popup (shows when a cruise port icon is clicked) */}
      {selectedPort && (
        <PortPopup
          port={selectedPort}
          cruises={portCruisesById[selectedPort.id] || []}
          nearbyVessels={vessels.filter(v => {
            const dLat = v.lat - selectedPort.lat;
            const dLon = v.lon - selectedPort.lon;
            const distKm = Math.hypot(dLat * 111, dLon * 111 * Math.cos(selectedPort.lat * Math.PI / 180));
            return distKm <= 3; // within ~3 km of port
          })}
          onClose={() => setSelectedPort(null)}
          anchorPos={popupPos}
        />
      )}

      </section>
    </>
  );
}

export default MapSection;
