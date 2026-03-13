import { useState, useEffect, useMemo } from 'react';
import { fetchParishes } from '../api/parishes';
import ParishDetail from './ParishDetail';
import PlaceList, { categoryLabels } from './PlaceList';
import PlacePopup from './PlacePopup';
import AirportDetail from './AirportDetail';
import { useDraggable } from '../hooks/useDraggable';

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

function InfoSection({ parish, notes, loading, addNote, selectedSlug, selectedAirport, onClose, onSelectParish, activeCategories, onCategoriesChange, filteredPlaces, allPlaces, onPlaceSelect }) {
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

  // Compute available categories from places in this parish
  const availableCategories = useMemo(() => {
    if (!allPlaces || !allPlaces.length) return [];
    const counts = {};
    for (const p of allPlaces) {
      counts[p.category] = (counts[p.category] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([cat, count]) => ({
        key: cat,
        label: categoryLabels[cat] || cat,
        icon: categoryIcons[cat] || '\u{1F4CD}',
        count,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allPlaces]);

  if (!selectedSlug && !displayedSlug && !selectedAirport) return null;

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

  const handleCategorySelect = (catKey) => {
    if (onCategoriesChange) {
      if (catKey === '') {
        onCategoriesChange(new Set());
      } else {
        onCategoriesChange(new Set([catKey]));
      }
    }
  };

  const selectedCat = activeCatList.length === 1 ? activeCatList[0] : '';

  return (
    <>
      <aside
        id="info-section"
        className={`${(visible && parish) || selectedAirport ? 'info-visible' : 'info-hidden'}${selectedAirport ? ' info-airport' : ''}`}
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
          {!selectedAirport && (
            <>
              <button
                className={`info-nav-btn${showParishPicker ? ' info-nav-btn-active' : ''}`}
                onClick={() => setShowParishPicker(!showParishPicker)}
              >
                <span>&#x25BE;</span> Switch Parish
              </button>
              {!loading && availableCategories.length > 0 && (
                <select
                  className="info-category-select"
                  value={selectedCat}
                  onChange={(e) => handleCategorySelect(e.target.value)}
                >
                  <option value="">-- Items --</option>
                  {availableCategories.map(c => (
                    <option key={c.key} value={c.key}>
                      {c.icon} {c.label} ({c.count})
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
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
          {selectedAirport ? (
            <AirportDetail airport={selectedAirport} onClose={onClose} />
          ) : loading ? (
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
