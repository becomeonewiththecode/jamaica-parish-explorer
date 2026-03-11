import { useState, useEffect, useCallback } from 'react';
import { fetchParish, fetchNotes, fetchPlaces, addNote as apiAddNote } from '../api/parishes';

export function useParish(slug) {
  const [parish, setParish] = useState(null);
  const [notes, setNotes] = useState([]);
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!slug) {
      setParish(null);
      setNotes([]);
      setPlaces([]);
      return;
    }

    setLoading(true);
    Promise.all([fetchParish(slug), fetchNotes(slug), fetchPlaces(slug)])
      .then(([p, n, pl]) => {
        setParish(p);
        setNotes(n);
        setPlaces(pl);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [slug]);

  const addNote = useCallback(async (author, content) => {
    if (!slug) return;
    const note = await apiAddNote(slug, author, content);
    setNotes(prev => [note, ...prev]);
  }, [slug]);

  const refreshNotes = useCallback(async () => {
    if (!slug) return;
    const n = await fetchNotes(slug);
    setNotes(n);
  }, [slug]);

  return { parish, notes, places, loading, addNote, refreshNotes };
}
