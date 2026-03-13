import { useState, useCallback, useMemo, useRef } from 'react';
import { useParish } from './hooks/useParish';
import MapSection from './components/MapSection';
import InfoSection from './components/InfoSection';
import SearchBar from './components/SearchBar';
import './App.css';

function App() {
  const [selectedSlug, setSelectedSlug] = useState(null);
  const [highlightedPlace, setHighlightedPlace] = useState(null);
  const [activeCategories, setActiveCategories] = useState(new Set());
  const [focusPlace, setFocusPlace] = useState(null);
  const focusKeyRef = useRef(0);
  const [focusKey, setFocusKey] = useState(0);
  const { parish, notes, places, loading, addNote } = useParish(selectedSlug);

  const filteredPlaces = useMemo(() => {
    if (!places || !places.length) return [];
    if (activeCategories.size === 0) return places;
    return places.filter(p => activeCategories.has(p.category));
  }, [places, activeCategories]);

  const handleSearchSelect = useCallback((place) => {
    setHighlightedPlace(place);
    setSelectedSlug(place.parish_slug);
  }, []);

  const handleParishSelect = useCallback((slug) => {
    setHighlightedPlace(null);
    setActiveCategories(new Set());
    setFocusPlace(null);
    setSelectedSlug(slug);
  }, []);

  const handleInfoPlaceSelect = useCallback((place) => {
    focusKeyRef.current += 1;
    setFocusKey(focusKeyRef.current);
    setFocusPlace(place);
  }, []);

  return (
    <div className="app">
      <MapSection
        activeSlug={selectedSlug}
        onSelect={handleParishSelect}
        parishPlaces={places}
        highlightedPlace={highlightedPlace}
        onClearHighlight={() => setHighlightedPlace(null)}
        activeCategories={activeCategories}
        onCategoriesChange={setActiveCategories}
        focusPlace={focusPlace}
        focusKey={focusKey}
      />
      <InfoSection
        parish={parish}
        notes={notes}
        loading={loading}
        addNote={addNote}
        selectedSlug={selectedSlug}
        onClose={() => setSelectedSlug(null)}
        onSelectParish={handleParishSelect}
        activeCategories={activeCategories}
        filteredPlaces={filteredPlaces}
        allPlaces={places}
        onPlaceSelect={handleInfoPlaceSelect}
      />
      <SearchBar onSelectPlace={handleSearchSelect} />
    </div>
  );
}

export default App;
