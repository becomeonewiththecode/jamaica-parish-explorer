import { useState, useEffect } from 'react';

const categoryLabels = {
  tourist_attraction: 'Attraction', landmark: 'Landmark',
  restaurant: 'Restaurant', cafe: 'Cafe', hotel: 'Hotel',
  hospital: 'Hospital', school: 'School', beach: 'Beach',
  place_of_worship: 'Place of Worship', bank: 'Bank',
  gas_station: 'Gas Station', park: 'Park',
  nightlife: 'Nightlife', shopping: 'Shopping',
};

const categoryIcons = {
  tourist_attraction: '\u{1F3DB}', landmark: '\u{1F3F0}',
  restaurant: '\u{1F37D}', cafe: '\u{2615}', hotel: '\u{1F3E8}',
  hospital: '\u{1F3E5}', school: '\u{1F393}', beach: '\u{1F3D6}',
  place_of_worship: '\u{26EA}', bank: '\u{1F3E6}',
  gas_station: '\u{26FD}', park: '\u{1F333}',
  nightlife: '\u{1F378}', shopping: '\u{1F6CD}',
};

// Global image cache to avoid re-fetching
const imageCache = new Map();

// Strategy 1: Wikipedia page summary
async function tryWikipedia(name, signal) {
  const variants = [
    name.replace(/\s+/g, '_'),
    name.replace(/\s+/g, '_') + ',_Jamaica',
  ];
  for (const title of variants) {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { signal }
    );
    if (!res.ok) continue;
    const data = await res.json();
    if (data.thumbnail && data.thumbnail.source) {
      return data.thumbnail.source.replace(/\/\d+px-/, '/400px-');
    }
  }
  return null;
}

// Strategy 2: Wikimedia Commons geosearch — finds photos taken near coordinates
async function tryCommonsGeosearch(lat, lon, signal) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${lat}|${lon}&ggsradius=500&ggslimit=5&prop=imageinfo&iiprop=url&iiurlwidth=400&format=json&origin=*`;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.query || !data.query.pages) return null;
  // Find the first page with a usable thumbnail
  for (const page of Object.values(data.query.pages)) {
    if (page.imageinfo && page.imageinfo[0]) {
      const info = page.imageinfo[0];
      if (info.thumburl) return info.thumburl;
      if (info.url && /\.(jpe?g|png|webp)$/i.test(info.url)) return info.url;
    }
  }
  return null;
}

// Strategy 3: OpenStreetMap static tile as last resort — always available
function osmTileFallback(lat, lon) {
  const zoom = 17;
  const n = Math.pow(2, zoom);
  const x = Math.floor((lon + 180) / 360 * n);
  const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
  return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
}

function PlacePopup({ place, onClose }) {
  const [imageUrl, setImageUrl] = useState(null);
  const [imageType, setImageType] = useState(null); // 'photo' or 'map'
  const [imageLoading, setImageLoading] = useState(true);

  useEffect(() => {
    if (!place) return;

    const cacheKey = `${place.id}-${place.name}`;
    if (imageCache.has(cacheKey)) {
      const cached = imageCache.get(cacheKey);
      setImageUrl(cached.url);
      setImageType(cached.type);
      setImageLoading(false);
      return;
    }

    setImageLoading(true);
    setImageUrl(null);
    setImageType(null);

    const controller = new AbortController();

    async function findImage() {
      // Try Wikipedia first (best for landmarks, attractions)
      try {
        const wikiUrl = await tryWikipedia(place.name, controller.signal);
        if (wikiUrl) {
          imageCache.set(cacheKey, { url: wikiUrl, type: 'photo' });
          setImageUrl(wikiUrl);
          setImageType('photo');
          setImageLoading(false);
          return;
        }
      } catch (e) {
        if (e.name === 'AbortError') return;
      }

      // Try Wikimedia Commons geosearch (photos near the coordinates)
      try {
        const commonsUrl = await tryCommonsGeosearch(place.lat, place.lon, controller.signal);
        if (commonsUrl) {
          imageCache.set(cacheKey, { url: commonsUrl, type: 'photo' });
          setImageUrl(commonsUrl);
          setImageType('photo');
          setImageLoading(false);
          return;
        }
      } catch (e) {
        if (e.name === 'AbortError') return;
      }

      // Fallback: OSM tile of the location
      const tileUrl = osmTileFallback(place.lat, place.lon);
      imageCache.set(cacheKey, { url: tileUrl, type: 'map' });
      setImageUrl(tileUrl);
      setImageType('map');
      setImageLoading(false);
    }

    findImage();
    return () => controller.abort();
  }, [place]);

  if (!place) return null;

  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lon}&travelmode=driving`;
  const categoryLabel = categoryLabels[place.category] || place.category;
  const categoryIcon = categoryIcons[place.category] || '\u{1F4CD}';

  return (
    <div className="place-popup-overlay" onClick={onClose}>
      <div className="place-popup" onClick={(e) => e.stopPropagation()}>
        <button className="popup-close" onClick={onClose}>&times;</button>

        {/* Image area */}
        <div className="popup-image-area">
          {imageLoading ? (
            <div className="popup-image-placeholder">
              <span className="placeholder-icon">{categoryIcon}</span>
              <span className="placeholder-label">Loading...</span>
            </div>
          ) : imageUrl && imageType === 'photo' ? (
            <img src={imageUrl} alt={place.name} className="popup-image" />
          ) : imageUrl && imageType === 'map' ? (
            <div className="popup-map-fallback">
              <img src={imageUrl} alt={`Map of ${place.name}`} className="popup-map-tile" />
              <div className="popup-map-overlay">
                <span className="placeholder-icon">{categoryIcon}</span>
                <span className="popup-map-label">{place.name}</span>
              </div>
            </div>
          ) : (
            <div className="popup-image-placeholder">
              <span className="placeholder-icon">{categoryIcon}</span>
              <span className="placeholder-label">{categoryLabel}</span>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="popup-info">
          <h3 className="popup-title">{place.name}</h3>
          <span className="popup-category">{categoryLabel}</span>

          {place.address && (
            <div className="popup-detail">
              <span className="popup-detail-icon">{'\u{1F4CD}'}</span>
              {place.address}
            </div>
          )}
          {place.phone && (
            <div className="popup-detail">
              <span className="popup-detail-icon">{'\u{1F4DE}'}</span>
              <a href={`tel:${place.phone}`}>{place.phone}</a>
            </div>
          )}
          {place.opening_hours && (
            <div className="popup-detail">
              <span className="popup-detail-icon">{'\u{1F552}'}</span>
              {place.opening_hours}
            </div>
          )}
          {place.cuisine && (
            <div className="popup-detail">
              <span className="popup-detail-icon">{'\u{1F374}'}</span>
              {place.cuisine}
            </div>
          )}
          {place.website && (
            <div className="popup-detail">
              <span className="popup-detail-icon">{'\u{1F310}'}</span>
              <a href={place.website} target="_blank" rel="noopener noreferrer">
                Visit Website
              </a>
            </div>
          )}

          {/* Google Maps driving link */}
          <a
            className="popup-directions-btn"
            href={googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="3 11 22 2 13 21 11 13 3 11" />
            </svg>
            Get Driving Directions
          </a>
        </div>
      </div>
    </div>
  );
}

export default PlacePopup;
