import { useState, useEffect, useRef } from 'react';

// Global cache so images persist across parish switches
const imageCache = new Map();

// Fetch a Wikipedia thumbnail for a place name
async function fetchWikiImage(name, signal) {
  if (imageCache.has(name)) return imageCache.get(name);

  const variants = [
    name.replace(/\s+/g, '_'),
    name.replace(/\s+/g, '_') + ',_Jamaica',
  ];

  for (const title of variants) {
    try {
      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        { signal }
      );
      if (!res.ok) continue;
      const data = await res.json();
      if (data.thumbnail && data.thumbnail.source) {
        const url = data.thumbnail.source.replace(/\/\d+px-/, '/200px-');
        imageCache.set(name, url);
        return url;
      }
    } catch (e) {
      if (e.name === 'AbortError') throw e;
    }
  }

  imageCache.set(name, null);
  return null;
}

export function usePlaceImages(places) {
  const [images, setImages] = useState({});
  const batchRef = useRef(0);

  useEffect(() => {
    if (!places || !places.length) {
      setImages({});
      return;
    }

    const batch = ++batchRef.current;
    const controller = new AbortController();

    // Start with cached results
    const initial = {};
    const toFetch = [];
    for (const p of places) {
      if (imageCache.has(p.name)) {
        initial[p.id] = imageCache.get(p.name);
      } else {
        toFetch.push(p);
      }
    }
    setImages(initial);

    // Fetch in small batches to avoid hammering Wikipedia
    async function fetchBatch() {
      for (let i = 0; i < toFetch.length; i++) {
        if (batch !== batchRef.current) return;
        const p = toFetch[i];
        try {
          const url = await fetchWikiImage(p.name, controller.signal);
          if (batch !== batchRef.current) return;
          setImages(prev => ({ ...prev, [p.id]: url }));
        } catch (e) {
          if (e.name === 'AbortError') return;
        }
        // Small delay between requests
        if (i < toFetch.length - 1) {
          await new Promise(r => setTimeout(r, 100));
        }
      }
    }

    fetchBatch();

    return () => controller.abort();
  }, [places]);

  return images;
}
