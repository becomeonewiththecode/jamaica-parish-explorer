import { useState, useEffect, useRef } from 'react';
import { searchPlaces } from '../api/parishes';

const categoryIcons = {
  tourist_attraction: '\u{1F3DB}', landmark: '\u{1F3F0}',
  restaurant: '\u{1F37D}', cafe: '\u{2615}', hotel: '\u{1F3E8}',
  hospital: '\u{1F3E5}', school: '\u{1F393}', beach: '\u{1F3D6}',
  place_of_worship: '\u{26EA}', bank: '\u{1F3E6}',
  gas_station: '\u{26FD}', park: '\u{1F333}',
  nightlife: '\u{1F378}', shopping: '\u{1F6CD}',
};

const PARISHES = [
  { name: 'Clarendon', slug: 'clarendon', display: 'Clarendon' },
  { name: 'Hanover', slug: 'hanover', display: 'Hanover' },
  { name: 'Kingston', slug: 'kingston', display: 'Kingston' },
  { name: 'Manchester', slug: 'manchester', display: 'Manchester' },
  { name: 'Portland', slug: 'portland', display: 'Portland' },
  { name: 'Saint Andrew', slug: 'st-andrew', display: 'St. Andrew' },
  { name: 'Saint Ann', slug: 'st-ann', display: 'St. Ann' },
  { name: 'Saint Catherine', slug: 'st-catherine', display: 'St. Catherine' },
  { name: 'Saint Elizabeth', slug: 'st-elizabeth', display: 'St. Elizabeth' },
  { name: 'Saint James', slug: 'st-james', display: 'St. James' },
  { name: 'Saint Mary', slug: 'st-mary', display: 'St. Mary' },
  { name: 'Saint Thomas', slug: 'st-thomas', display: 'St. Thomas' },
  { name: 'Trelawny', slug: 'trelawny', display: 'Trelawny' },
  { name: 'Westmoreland', slug: 'westmoreland', display: 'Westmoreland' },
];

const MAX_PARISH_RESULTS = 4;
const MAX_PLACE_RESULTS = 6;

function SearchBar({ onSelectPlace, onSelectParish, liveDataOn }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef(null);
  const debounceRef = useRef(null);

  // Filter and rank parishes by match quality, capped at MAX_PARISH_RESULTS
  const matchingParishes = (() => {
    const raw = query.trim();
    if (raw.length < 2) return [];
    const q = raw.toLowerCase();
    // Normalise "st " / "st." to "saint " so "st james" matches "Saint James"
    const normQ = q.replace(/^st\.?\s/i, 'saint ');
    const slugQ = q.replace(/\s+/g, '-');

    const scored = PARISHES
      .map(p => {
        const name = p.name.toLowerCase();
        const display = p.display.toLowerCase();
        const slug = p.slug;
        // Score: lower is better. -1 means no match.
        let score = -1;
        if (name === normQ || name === q || display === q) score = 0;           // exact
        else if (name.startsWith(normQ) || name.startsWith(q) || display.startsWith(q)) score = 1; // prefix
        else if (slug.startsWith(slugQ)) score = 2;                             // slug prefix
        else if (name.includes(normQ) || name.includes(q) || slug.includes(slugQ)) score = 3; // substring
        return { ...p, score };
      })
      .filter(p => p.score >= 0)
      .sort((a, b) => a.score - b.score);

    return scored.slice(0, MAX_PARISH_RESULTS);
  })();

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }

    setLoading(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const data = await searchPlaces(query);
      setResults(data);
      setOpen(data.length > 0 || matchingParishes.length > 0);
      setLoading(false);
    }, 250);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  // Also open dropdown when only parishes match (no API delay needed)
  useEffect(() => {
    if (matchingParishes.length > 0 && query.trim().length >= 2) {
      setOpen(true);
    }
  }, [matchingParishes.length, query]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelect = (place) => {
    setQuery('');
    setResults([]);
    setOpen(false);
    onSelectPlace(place);
  };

  const handleParishClick = (parish) => {
    setQuery('');
    setResults([]);
    setOpen(false);
    if (onSelectParish) onSelectParish(parish.slug);
  };

  return (
    <div className="search-bar" ref={containerRef}>
      <div className="search-input-wrap">
        <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          className="search-input"
          placeholder={liveDataOn ? "Search parishes and places..." : "Select a parish or place..."}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => (results.length > 0 || matchingParishes.length > 0) && setOpen(true)}
        />
        {query && (
          <button className="search-clear" onClick={() => { setQuery(''); setResults([]); setOpen(false); }}>
            &times;
          </button>
        )}
      </div>
      {open && (
        <div className="search-results">
          {matchingParishes.map((p) => (
            <button
              key={`parish-${p.slug}`}
              className="search-result-item search-result-parish-item"
              onClick={() => handleParishClick(p)}
            >
              <span className="search-result-icon">{'\u{1F5FA}'}</span>
              <div className="search-result-info">
                <span className="search-result-name">{p.display}</span>
                <span className="search-result-parish">Parish</span>
              </div>
            </button>
          ))}
          {matchingParishes.length > 0 && results.length > 0 && (
            <div className="search-results-divider" />
          )}
          {results.slice(0, MAX_PLACE_RESULTS).map((place) => (
            <button
              key={place.id}
              className="search-result-item"
              onClick={() => handleSelect(place)}
            >
              <span className="search-result-icon">
                {categoryIcons[place.category] || '\u{1F4CD}'}
              </span>
              <div className="search-result-info">
                <span className="search-result-name">{place.name}</span>
                <span className="search-result-parish">{place.parish_name}</span>
              </div>
            </button>
          ))}
          {results.length > MAX_PLACE_RESULTS && (
            <div className="search-results-hint">
              Keep typing to narrow results...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SearchBar;
