import { useState, useEffect } from 'react';
import { fetchWebsiteImage } from '../api/parishes';

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

// Cache for fetched images
const imageCache = new Map();

function PlaceListItem({ place, onSelect }) {
  const [imageUrl, setImageUrl] = useState(null);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    const cacheKey = `list-${place.id}`;
    if (imageCache.has(cacheKey)) {
      setImageUrl(imageCache.get(cacheKey));
      return;
    }

    // Use DB image if available
    if (place.image_url && place.image_url !== '') {
      imageCache.set(cacheKey, place.image_url);
      setImageUrl(place.image_url);
      return;
    }

    // Try Wikipedia for an image — Jamaica-specific first
    let cancelled = false;
    const base = place.name.replace(/\s+/g, '_');
    const wikiVariants = [base + ',_Jamaica', base + '_(Jamaica)', base];

    async function tryWiki() {
      for (const title of wikiVariants) {
        try {
          const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
          if (!res.ok) continue;
          const data = await res.json();
          if (cancelled) return;
          // For generic name, verify it's about Jamaica
          if (title === base && data.extract) {
            const lower = data.extract.toLowerCase();
            if (!lower.includes('jamaica') && !lower.includes('kingston') && !lower.includes('caribbean') && !lower.includes('west indies')) continue;
          }
          const img = data?.thumbnail?.source?.replace(/\/\d+px-/, '/200px-') || null;
          if (img) {
            imageCache.set(cacheKey, img);
            if (!cancelled) setImageUrl(img);
            return;
          }
        } catch { /* ignore */ }
      }
      imageCache.set(cacheKey, null);
    }
    tryWiki();

    return () => { cancelled = true; };
  }, [place]);

  const icon = categoryIcons[place.category] || '\u{1F4CD}';
  const label = categoryLabels[place.category] || place.category;
  const blurb = place.description && place.description !== ''
    ? place.description
    : place.address || label;
  // Truncate blurb
  const shortBlurb = blurb.length > 80 ? blurb.slice(0, 80) + '...' : blurb;

  return (
    <button className="place-list-item" onClick={() => onSelect(place)}>
      <div className="place-list-thumb">
        {imageUrl && !imgError ? (
          <img src={imageUrl} alt={place.name} onError={() => setImgError(true)} />
        ) : (
          <span className="place-list-thumb-icon">{icon}</span>
        )}
      </div>
      <div className="place-list-info">
        <span className="place-list-name">{place.name}</span>
        <span className="place-list-blurb">{shortBlurb}</span>
      </div>
    </button>
  );
}

function PlaceList({ places, categoryLabel, onSelectPlace }) {
  return (
    <div className="place-list">
      <h3 className="place-list-title">{categoryLabel} ({places.length})</h3>
      <div className="place-list-items">
        {places.map(p => (
          <PlaceListItem key={p.id} place={p} onSelect={onSelectPlace} />
        ))}
      </div>
    </div>
  );
}

export default PlaceList;
export { categoryLabels };
