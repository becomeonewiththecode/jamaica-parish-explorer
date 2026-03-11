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

function SearchBar({ onSelectPlace }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef(null);
  const debounceRef = useRef(null);

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
      setOpen(data.length > 0);
      setLoading(false);
    }, 250);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

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
          placeholder="Search places across Jamaica..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
        />
        {query && (
          <button className="search-clear" onClick={() => { setQuery(''); setResults([]); setOpen(false); }}>
            &times;
          </button>
        )}
      </div>
      {open && (
        <div className="search-results">
          {results.map((place) => (
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
        </div>
      )}
    </div>
  );
}

export default SearchBar;
