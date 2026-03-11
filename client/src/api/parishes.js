const API = '/api';

export async function fetchParishes() {
  const res = await fetch(`${API}/parishes`);
  if (!res.ok) throw new Error('Failed to fetch parishes');
  return res.json();
}

export async function fetchParish(slug) {
  const res = await fetch(`${API}/parishes/${slug}`);
  if (!res.ok) throw new Error('Failed to fetch parish');
  return res.json();
}

export async function fetchNotes(slug) {
  const res = await fetch(`${API}/parishes/${slug}/notes`);
  if (!res.ok) throw new Error('Failed to fetch notes');
  return res.json();
}

export async function addNote(slug, author, content) {
  const res = await fetch(`${API}/parishes/${slug}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ author, content })
  });
  if (!res.ok) throw new Error('Failed to add note');
  return res.json();
}

export async function deleteNote(id) {
  const res = await fetch(`${API}/notes/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete note');
  return res.json();
}

export async function fetchPlaces(slug, category) {
  const params = category ? `?category=${encodeURIComponent(category)}` : '';
  const res = await fetch(`${API}/parishes/${slug}/places${params}`);
  if (!res.ok) throw new Error('Failed to fetch places');
  return res.json();
}

export async function fetchAllPlaces(category) {
  const params = category ? `?category=${encodeURIComponent(category)}` : '';
  const res = await fetch(`${API}/places/all${params}`);
  if (!res.ok) throw new Error('Failed to fetch places');
  return res.json();
}

export async function fetchCategories() {
  const res = await fetch(`${API}/places/categories`);
  if (!res.ok) throw new Error('Failed to fetch categories');
  return res.json();
}

export async function searchPlaces(query) {
  if (!query || query.trim().length < 2) return [];
  const res = await fetch(`${API}/places/search?q=${encodeURIComponent(query.trim())}`);
  if (!res.ok) return [];
  return res.json();
}

export async function fetchWebsiteImage(url) {
  const res = await fetch(`${API}/places/website-image?url=${encodeURIComponent(url)}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.image || null;
}
