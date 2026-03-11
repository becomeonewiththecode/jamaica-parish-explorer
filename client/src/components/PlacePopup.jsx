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

function PlacePopup({ place, onClose }) {
  const [imageUrl, setImageUrl] = useState(null);
  const [imageLoading, setImageLoading] = useState(true);

  useEffect(() => {
    if (!place) return;
    setImageLoading(true);
    setImageUrl(null);

    // Try Wikipedia API for an image
    const searchName = place.name.replace(/\s+/g, '_');
    const controller = new AbortController();

    // Try exact title first, then search
    fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(searchName)}`,
      { signal: controller.signal }
    )
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        if (data.thumbnail && data.thumbnail.source) {
          // Get a larger version
          const url = data.thumbnail.source.replace(/\/\d+px-/, '/400px-');
          setImageUrl(url);
        }
      })
      .catch(() => {
        // Try search with "Jamaica" appended for better results
        fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(searchName + ',_Jamaica')}`,
          { signal: controller.signal }
        )
          .then(r => r.ok ? r.json() : Promise.reject())
          .then(data => {
            if (data.thumbnail && data.thumbnail.source) {
              const url = data.thumbnail.source.replace(/\/\d+px-/, '/400px-');
              setImageUrl(url);
            }
          })
          .catch(() => {});
      })
      .finally(() => setImageLoading(false));

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
          {imageUrl ? (
            <img src={imageUrl} alt={place.name} className="popup-image" />
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
