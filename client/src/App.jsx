import { useState, useCallback, useMemo, useRef } from 'react';
import { useParish } from './hooks/useParish';
import MapSection from './components/MapSection';
import InfoSection from './components/InfoSection';
import SearchBar from './components/SearchBar';
import './App.css';

function App() {
  const [selectedSlug, setSelectedSlug] = useState(null);
  const [selectedAirport, setSelectedAirport] = useState(null);
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
    setSelectedAirport(null);
    setSelectedSlug(slug);
  }, []);

  const handleAirportSelect = useCallback((airport) => {
    setSelectedAirport(airport);
    setSelectedSlug(null);
    setHighlightedPlace(null);
    setActiveCategories(new Set());
    setFocusPlace(null);
  }, []);

  const handleInfoPlaceSelect = useCallback((place) => {
    focusKeyRef.current += 1;
    setFocusKey(focusKeyRef.current);
    setFocusPlace(place);
  }, []);

  const handleFlightSelect = useCallback((flight) => {
    if (flight && flight.lat && flight.lon) {
      focusKeyRef.current += 1;
      setFocusKey(focusKeyRef.current);
      setFocusPlace({ lat: flight.lat, lon: flight.lon, id: flight.id });
    }
  }, []);

  return (
    <div className="app">
      <MapSection
        activeSlug={selectedSlug}
        onSelect={handleParishSelect}
        onAirportSelect={handleAirportSelect}
        parishPlaces={places}
        highlightedPlace={highlightedPlace}
        onClearHighlight={() => setHighlightedPlace(null)}
        activeCategories={activeCategories}
        onCategoriesChange={setActiveCategories}
        focusPlace={focusPlace}
        focusKey={focusKey}
      >
        <SearchBar onSelectPlace={handleSearchSelect} />
      </MapSection>
      <InfoSection
        parish={parish}
        notes={notes}
        loading={loading}
        addNote={addNote}
        selectedSlug={selectedSlug}
        selectedAirport={selectedAirport}
        onClose={() => { setSelectedSlug(null); setSelectedAirport(null); }}
        onSelectParish={handleParishSelect}
        onAirportSelect={handleAirportSelect}
        activeCategories={activeCategories}
        onCategoriesChange={setActiveCategories}
        filteredPlaces={filteredPlaces}
        allPlaces={places}
        onPlaceSelect={handleInfoPlaceSelect}
        onFlightSelect={handleFlightSelect}
      />
    </div>
  );
}

export default App;
