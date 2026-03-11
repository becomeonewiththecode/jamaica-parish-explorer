import { useState, useEffect } from 'react';
import ParishDetail from './ParishDetail';

function InfoSection({ parish, notes, loading, addNote, selectedSlug }) {
  const [visible, setVisible] = useState(false);
  const [displayedSlug, setDisplayedSlug] = useState(null);

  useEffect(() => {
    if (selectedSlug !== displayedSlug) {
      setVisible(false);
      const timer = setTimeout(() => {
        setDisplayedSlug(selectedSlug);
        setVisible(true);
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [selectedSlug, displayedSlug]);

  return (
    <aside id="info-section">
      <div id="info-content" className={visible ? 'fade-in' : 'fade-out'}>
        {!displayedSlug || !parish ? (
          <div id="info-placeholder">
            <div className="icon">&#x1F1EF;&#x1F1F2;</div>
            <h2>Jamaica</h2>
            <p>Click on any parish on the map to explore its details.</p>
          </div>
        ) : loading ? (
          <div id="info-placeholder">
            <h2>Loading...</h2>
          </div>
        ) : (
          <ParishDetail parish={parish} notes={notes} onAddNote={addNote} />
        )}
      </div>
    </aside>
  );
}

export default InfoSection;
