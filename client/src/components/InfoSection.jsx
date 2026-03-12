import { useState, useEffect } from 'react';
import ParishDetail from './ParishDetail';
import { useDraggable } from '../hooks/useDraggable';

function InfoSection({ parish, notes, loading, addNote, selectedSlug, onClose }) {
  const [visible, setVisible] = useState(false);
  const [displayedSlug, setDisplayedSlug] = useState(null);
  const { pos, onMouseDown, reset } = useDraggable();

  useEffect(() => {
    if (selectedSlug !== displayedSlug) {
      setVisible(false);
      reset();
      const timer = setTimeout(() => {
        setDisplayedSlug(selectedSlug);
        if (selectedSlug) setVisible(true);
      }, selectedSlug ? 300 : 0);
      return () => clearTimeout(timer);
    }
  }, [selectedSlug, displayedSlug, reset]);

  if (!selectedSlug && !displayedSlug) return null;

  return (
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
      <div id="info-content">
        {loading ? (
          <div id="info-placeholder">
            <h2>Loading...</h2>
          </div>
        ) : parish ? (
          <ParishDetail parish={parish} notes={notes} onAddNote={addNote} />
        ) : null}
      </div>
    </aside>
  );
}

export default InfoSection;
