import { useState, useEffect } from 'react';
import { fetchParishes } from '../api/parishes';
import ParishDetail from './ParishDetail';
import PlaceList, { categoryLabels } from './PlaceList';
import PlacePopup from './PlacePopup';
import { useDraggable } from '../hooks/useDraggable';

function InfoSection({ parish, notes, loading, addNote, selectedSlug, onClose, onSelectParish, activeCategories, filteredPlaces, allPlaces, onPlaceSelect }) {
  const [visible, setVisible] = useState(false);
  const [displayedSlug, setDisplayedSlug] = useState(null);
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [parishes, setParishes] = useState([]);
  const [showParishPicker, setShowParishPicker] = useState(false);
  const { pos, onMouseDown, reset } = useDraggable();

  // Fetch all parishes once
  useEffect(() => {
    fetchParishes()
      .then(list => setParishes(list))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedSlug !== displayedSlug) {
      setVisible(false);
      reset();
      setShowParishPicker(false);
      const timer = setTimeout(() => {
        setDisplayedSlug(selectedSlug);
        if (selectedSlug) setVisible(true);
      }, selectedSlug ? 300 : 0);
      return () => clearTimeout(timer);
    }
  }, [selectedSlug, displayedSlug, reset]);

  // Clear selected place when categories change
  useEffect(() => {
    setSelectedPlace(null);
  }, [activeCategories]);

  if (!selectedSlug && !displayedSlug) return null;

  // Determine the category label for the heading
  const activeCatList = activeCategories ? [...activeCategories] : [];
  const showPlaceList = activeCatList.length > 0 && filteredPlaces && filteredPlaces.length > 0;
  const categoryTitle = activeCatList.length === 1
    ? (categoryLabels[activeCatList[0]] || activeCatList[0])
    : 'Selected Places';

  const handlePlaceSelect = (place) => {
    setSelectedPlace(place);
    if (onPlaceSelect) onPlaceSelect(place);
  };

  const handleParishSwitch = (slug) => {
    setShowParishPicker(false);
    if (onSelectParish) onSelectParish(slug);
  };

  return (
    <>
      <aside
        id="info-section"
        className={visible && parish ? 'info-visible' : 'info-hidden'}
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      >
        <div className="drag-handle" onMouseDown={onMouseDown}>
          <span className="drag-dots">&#x2807;</span>
          <span className="drag-hint">Drag to move</span>
        </div>
        <button className="info-close-btn" onClick={onClose}>&times;</button>

        {/* Navigation bar */}
        <div className="info-nav">
          <button className="info-nav-btn" onClick={onClose}>
            <span>&#x2190;</span> Back to Map
          </button>
          <button
            className={`info-nav-btn${showParishPicker ? ' info-nav-btn-active' : ''}`}
            onClick={() => setShowParishPicker(!showParishPicker)}
          >
            <span>&#x25BE;</span> Switch Parish
          </button>
        </div>

        {/* Parish picker dropdown */}
        {showParishPicker && (
          <div className="parish-picker">
            {parishes
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(p => (
              <button
                key={p.slug}
                className={`parish-picker-item${p.slug === selectedSlug ? ' parish-picker-active' : ''}`}
                onClick={() => handleParishSwitch(p.slug)}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}

        {showPlaceList && parish && (
          <div className="info-context-header">
            <span className="info-parish-label">{parish.name}</span>
            <span className="info-category-label">{categoryTitle}</span>
          </div>
        )}
        <div id="info-content">
          {loading ? (
            <div id="info-placeholder">
              <h2>Loading...</h2>
            </div>
          ) : showPlaceList ? (
            <PlaceList
              places={filteredPlaces}
              categoryLabel={categoryTitle}
              onSelectPlace={handlePlaceSelect}
            />
          ) : parish ? (
            <ParishDetail parish={parish} notes={notes} onAddNote={addNote} places={allPlaces} onFeatureClick={handlePlaceSelect} />
          ) : null}
        </div>
      </aside>

      {selectedPlace && (
        <PlacePopup
          place={selectedPlace}
          onClose={() => setSelectedPlace(null)}
        />
      )}
    </>
  );
}

export default InfoSection;
