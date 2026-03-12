import { useState, useCallback } from 'react';
import { useParish } from './hooks/useParish';
import MapSection from './components/MapSection';
import InfoSection from './components/InfoSection';
import SearchBar from './components/SearchBar';
import './App.css';

function App() {
  const [selectedSlug, setSelectedSlug] = useState(null);
  const [highlightedPlace, setHighlightedPlace] = useState(null);
  const { parish, notes, places, loading, addNote } = useParish(selectedSlug);

  const handleSearchSelect = useCallback((place) => {
    setHighlightedPlace(place);
    setSelectedSlug(place.parish_slug);
  }, []);

  const handleParishSelect = useCallback((slug) => {
    setHighlightedPlace(null);
    setSelectedSlug(slug);
  }, []);

  return (
    <div className="app">
      <MapSection
        activeSlug={selectedSlug}
        onSelect={handleParishSelect}
        parishPlaces={places}
        highlightedPlace={highlightedPlace}
        onClearHighlight={() => setHighlightedPlace(null)}
      />
      <InfoSection
        parish={parish}
        notes={notes}
        loading={loading}
        addNote={addNote}
        selectedSlug={selectedSlug}
        onClose={() => setSelectedSlug(null)}
      />
      <SearchBar onSelectPlace={handleSearchSelect} />
    </div>
  );
}

export default App;
