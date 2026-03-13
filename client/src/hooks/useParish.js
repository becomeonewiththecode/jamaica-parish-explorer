import { useState, useEffect, useCallback } from 'react';
import { fetchParish, fetchNotes, fetchPlaces, fetchAirports, addNote as apiAddNote } from '../api/parishes';

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
    Promise.all([fetchParish(slug), fetchNotes(slug), fetchPlaces(slug), fetchAirports()])
      .then(([p, n, pl, airports]) => {
        // Inject airports in this parish as place-like objects
        const parishAirports = (airports || [])
          .filter(a => a.parish_slug === slug)
          .map(a => ({
            id: `airport-${a.code}`,
            name: a.name,
            category: 'airport',
            lat: a.lat,
            lon: a.lon,
            website: a.website,
            _airportData: a,
          }));
        setParish(p);
        setNotes(n);
        setPlaces([...parishAirports, ...pl]);
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
