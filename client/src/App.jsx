import { useState } from 'react';
import { useParish } from './hooks/useParish';
import MapSection from './components/MapSection';
import InfoSection from './components/InfoSection';
import './App.css';

function App() {
  const [selectedSlug, setSelectedSlug] = useState(null);
  const { parish, notes, places, loading, addNote } = useParish(selectedSlug);

  return (
    <div className="app">
      <InfoSection
        parish={parish}
        notes={notes}
        loading={loading}
        addNote={addNote}
        selectedSlug={selectedSlug}
      />
      <MapSection
        activeSlug={selectedSlug}
        onSelect={setSelectedSlug}
        parishPlaces={places}
      />
    </div>
  );
}

export default App;
