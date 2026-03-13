import { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';

const nameToSlug = {
  "Hanover": "hanover", "Westmoreland": "westmoreland",
  "Saint James": "st-james", "Trelawny": "trelawny",
  "Saint Ann": "st-ann", "Saint Elizabeth": "st-elizabeth",
  "Manchester": "manchester", "Clarendon": "clarendon",
  "Saint Mary": "st-mary", "Saint Catherine": "st-catherine",
  "Saint Andrew": "st-andrew", "Kingston": "kingston",
  "Saint Thomas": "st-thomas", "Portland": "portland",
};

function FitBounds({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [10, 10], animate: false });
    }
  }, [bounds, map]);
  return null;
}

function ParishMiniMap({ slug }) {
  const [geojson, setGeojson] = useState(null);

  useEffect(() => {
    fetch('/jamaica-parishes.geojson')
      .then(r => r.json())
      .then(setGeojson)
      .catch(console.error);
  }, []);

  const feature = useMemo(() => {
    if (!geojson || !slug) return null;
    return geojson.features.find(f => nameToSlug[f.properties.shapeName] === slug) || null;
  }, [geojson, slug]);

  const bounds = useMemo(() => {
    if (!feature) return null;
    const layer = L.geoJSON(feature);
    return layer.getBounds();
  }, [feature]);

  if (!feature || !bounds) return null;

  return (
    <div className="parish-mini-map">
      <MapContainer
        center={bounds.getCenter()}
        zoom={10}
        zoomControl={false}
        dragging={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        touchZoom={false}
        attributionControl={false}
        style={{ width: '100%', height: '100%' }}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <FitBounds bounds={bounds} />
        <GeoJSON
          key={slug}
          data={feature}
          style={{
            fillColor: '#f0c040',
            fillOpacity: 0.3,
            color: '#f0c040',
            weight: 2,
          }}
        />
      </MapContainer>
    </div>
  );
}

export default ParishMiniMap;
