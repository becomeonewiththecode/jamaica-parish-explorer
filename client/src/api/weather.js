import { fetchWithRetry } from './fetchWithRetry';

const API = '/api';

export async function fetchWeather(lat, lon) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  const res = await fetchWithRetry(`${API}/weather?${params}`);
  if (!res.ok) throw new Error('Failed to fetch weather');
  return res.json();
}

export async function fetchWeatherForParish(slug) {
  const res = await fetchWithRetry(`${API}/weather/parish/${encodeURIComponent(slug)}`);
  if (!res.ok) throw new Error('Failed to fetch weather');
  return res.json();
}

export async function fetchWeatherIsland() {
  const res = await fetchWithRetry(`${API}/weather/island`);
  if (!res.ok) throw new Error('Failed to fetch island weather');
  return res.json();
}

export async function fetchWavesIsland() {
  const res = await fetchWithRetry(`${API}/weather/waves`);
  if (!res.ok) return [];
  return res.json();
}
