import { useState, useEffect } from 'react';
import { fetchWebsiteImage } from '../api/parishes';
import { useDraggable } from '../hooks/useDraggable';

const categoryLabels = {
  tourist_attraction: 'Attraction', landmark: 'Landmark',
  restaurant: 'Restaurant', cafe: 'Cafe', hotel: 'Hotel',
  guest_house: 'Guest House', resort: 'Resort',
  hospital: 'Hospital', school: 'School', beach: 'Beach',
  place_of_worship: 'Place of Worship', bank: 'Bank',
  gas_station: 'Gas Station', park: 'Park',
  nightlife: 'Nightlife', shopping: 'Shopping',
  car_rental: 'Car Rental',
  stadium: 'Stadium',
};

const categoryIcons = {
  tourist_attraction: '\u{1F3DB}', landmark: '\u{1F3F0}',
  restaurant: '\u{1F37D}', cafe: '\u{2615}', hotel: '\u{1F3E8}',
  guest_house: '\u{1F3E1}', resort: '\u{1F334}',
  hospital: '\u{1F3E5}', school: '\u{1F393}', beach: '\u{1F3D6}',
  place_of_worship: '\u{26EA}', bank: '\u{1F3E6}',
  gas_station: '\u{26FD}', park: '\u{1F333}',
  nightlife: '\u{1F378}', shopping: '\u{1F6CD}',
  car_rental: '\u{1F697}',
  stadium: '\u{1F3DF}',
};

// Global cache to avoid re-fetching images and descriptions
const placeCache = new Map();

// Wikipedia exact page match — returns both image and description
// Prioritize Jamaica-specific results to avoid wrong-country matches
async function tryWikipediaExact(name, signal) {
  const base = name.replace(/\s+/g, '_');
  // Try Jamaica-specific variants first
  const variants = [
    base + ',_Jamaica',
    base + '_(Jamaica)',
    base + ',_Kingston',
    base,
  ];

  for (const title of variants) {
    try {
      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        { signal }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const image = data.thumbnail && data.thumbnail.source
        ? data.thumbnail.source.replace(/\/\d+px-/, '/400px-')
        : null;
      const description = data.extract || null;
      if (!image && !description) continue;

      // For the generic (non-Jamaica) variant, verify the content is about Jamaica
      if (title === base && description) {
        const lower = description.toLowerCase();
        const isJamaica = lower.includes('jamaica') || lower.includes('kingston') ||
          lower.includes('caribbean') || lower.includes('west indies');
        if (!isJamaica) continue; // Skip — likely a different country
      }

      return { image, description };
    } catch (e) {
      if (e.name === 'AbortError') throw e;
    }
  }
  return null;
}

// Strategy 2: Wikimedia Commons geosearch — photos taken very close to coordinates
async function tryCommonsGeosearch(lat, lon, signal) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${lat}|${lon}&ggsradius=250&ggslimit=5&prop=imageinfo&iiprop=url&iiurlwidth=400&format=json&origin=*`;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.query || !data.query.pages) return null;
  for (const page of Object.values(data.query.pages)) {
    if (page.imageinfo && page.imageinfo[0]) {
      const info = page.imageinfo[0];
      if (info.thumburl) return info.thumburl;
      if (info.url && /\.(jpe?g|png|webp)$/i.test(info.url)) return info.url;
    }
  }
  return null;
}

// Fallback: Esri satellite aerial imagery of the actual location
function satelliteTileUrl(lat, lon) {
  const zoom = 18;
  const n = Math.pow(2, zoom);
  const x = Math.floor((lon + 180) / 360 * n);
  const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`;
}

function PlacePopup({ place, onClose, anchorPos }) {
  const [imageUrl, setImageUrl] = useState(null);
  const [imageType, setImageType] = useState(null);
  const [description, setDescription] = useState(null);
  const [loading, setLoading] = useState(true);
  const { pos, onMouseDown } = useDraggable();

  useEffect(() => {
    if (!place) return;

    const cacheKey = `${place.id}-${place.name}`;
    if (placeCache.has(cacheKey)) {
      const cached = placeCache.get(cacheKey);
      setImageUrl(cached.imageUrl);
      setImageType(cached.imageType);
      setDescription(cached.description);
      setLoading(false);
      return;
    }

    // Use pre-fetched data from the DB if available
    const dbImage = place.image_url && place.image_url !== '' ? place.image_url : null;
    const dbDesc = place.description && place.description !== '' ? place.description : null;

    if (dbImage) {
      const result = { imageUrl: dbImage, imageType: 'photo', description: dbDesc };
      placeCache.set(cacheKey, result);
      setImageUrl(dbImage);
      setImageType('photo');
      setDescription(dbDesc);
      setLoading(false);
      return;
    }

    // No pre-fetched image — try client-side lookup
    setLoading(true);
    setImageUrl(null);
    setImageType(null);
    setDescription(dbDesc);

    const controller = new AbortController();

    async function fetchPlaceData() {
      let foundImage = null;
      let foundDescription = dbDesc;

      // Try website og:image
      if (place.website) {
        try {
          const siteImage = await fetchWebsiteImage(place.website);
          if (siteImage) foundImage = siteImage;
        } catch (e) { /* ignore */ }
      }

      // Try Wikipedia
      if (!foundImage || !foundDescription) {
        try {
          const wikiResult = await tryWikipediaExact(place.name, controller.signal);
          if (wikiResult) {
            if (!foundImage && wikiResult.image) foundImage = wikiResult.image;
            if (!foundDescription && wikiResult.description) foundDescription = wikiResult.description;
          }
        } catch (e) {
          if (e.name === 'AbortError') return;
        }
      }

      // Try Commons geosearch
      if (!foundImage) {
        try {
          const commonsUrl = await tryCommonsGeosearch(place.lat, place.lon, controller.signal);
          if (commonsUrl) foundImage = commonsUrl;
        } catch (e) {
          if (e.name === 'AbortError') return;
        }
      }

      let finalImageUrl, finalImageType;
      if (foundImage) {
        finalImageUrl = foundImage;
        finalImageType = 'photo';
      } else {
        finalImageUrl = satelliteTileUrl(place.lat, place.lon);
        finalImageType = 'satellite';
      }

      const result = { imageUrl: finalImageUrl, imageType: finalImageType, description: foundDescription };
      placeCache.set(cacheKey, result);
      setImageUrl(finalImageUrl);
      setImageType(finalImageType);
      setDescription(foundDescription);
      setLoading(false);
    }

    fetchPlaceData();
    return () => controller.abort();
  }, [place]);

  if (!place) return null;

  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=Kingston,+Jamaica&destination=${place.lat},${place.lon}&travelmode=driving`;
  const categoryLabel = categoryLabels[place.category] || place.category;
  const categoryIcon = categoryIcons[place.category] || '\u{1F4CD}';

  return (
    <div
      className={`place-popup${anchorPos ? ' place-popup-anchored' : ''}`}
      style={anchorPos
        ? { left: anchorPos.x + 'px', top: anchorPos.y + 'px', transform: `translate(${pos.x}px, ${pos.y}px)` }
        : { transform: `translate(${pos.x}px, ${pos.y}px)` }
      }
      onDoubleClick={onClose}
    >
      <div className="drag-handle" onMouseDown={onMouseDown}>
        <span className="drag-dots">&#x2807;</span>
        <span className="drag-hint">Drag to move &middot; Double-click to close</span>
      </div>
      <button className="popup-close" onClick={onClose}>&times;</button>

        {/* Image area */}
        <div className="popup-image-area">
          {loading ? (
            <div className="popup-image-placeholder">
              <span className="placeholder-icon">{categoryIcon}</span>
              <span className="placeholder-label">Loading...</span>
            </div>
          ) : imageUrl && imageType === 'photo' ? (
            <img src={imageUrl} alt={place.name} className="popup-image" />
          ) : imageUrl && imageType === 'satellite' ? (
            <div className="popup-satellite-fallback">
              <img src={imageUrl} alt={`Aerial view of ${place.name}`} className="popup-satellite-tile" />
              <div className="popup-satellite-overlay">
                <span className="placeholder-icon">{categoryIcon}</span>
              </div>
              <span className="popup-satellite-label">Aerial view</span>
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
          <div className="popup-type-badge">
            <span className="popup-type-icon">{categoryIcon}</span>
            <span>{categoryLabel}</span>
          </div>

          {description && (
            <p className="popup-description">{description}</p>
          )}

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
              Cuisine: {place.cuisine.replace(/;/g, ', ')}
            </div>
          )}

          {/* Website link */}
          {place.website && (
            <a className="popup-link-btn" href={place.website} target="_blank" rel="noopener noreferrer">
              <span>{'\u{1F310}'}</span>
              Visit Website
            </a>
          )}

          {/* Menu link for restaurants/cafes */}
          {(place.category === 'restaurant' || place.category === 'cafe') && (
            place.menu_url ? (
              <a
                className="popup-link-btn popup-menu-btn"
                href={place.menu_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>{'\u{1F4CB}'}</span>
                View Menu
              </a>
            ) : place.website ? (
              <a
                className="popup-link-btn popup-menu-btn"
                href={place.website.replace(/\/$/, '') + '/menu'}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>{'\u{1F4CB}'}</span>
                View Menu
              </a>
            ) : (
              <a
                className="popup-link-btn popup-menu-btn"
                href={`https://www.google.com/search?q=${encodeURIComponent(place.name + ' Jamaica menu')}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>{'\u{1F4CB}'}</span>
                Search for Menu
              </a>
            )
          )}

          {/* TikTok link */}
          {place.tiktok_url && (
            <a className="popup-link-btn popup-tiktok-btn" href={place.tiktok_url} target="_blank" rel="noopener noreferrer">
              <span>{'\u{1F3B5}'}</span>
              TikTok
            </a>
          )}

          {/* Google Maps driving directions (from Kingston, Jamaica) */}
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
  );
}

export default PlacePopup;
