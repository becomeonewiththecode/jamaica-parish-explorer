const API = '/api';

export async function fetchWeather(lat, lon) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  const res = await fetch(`${API}/weather?${params}`);
  if (!res.ok) throw new Error('Failed to fetch weather');
  return res.json();
}

export async function fetchWeatherForParish(slug) {
  const res = await fetch(`${API}/weather/parish/${encodeURIComponent(slug)}`);
  if (!res.ok) throw new Error('Failed to fetch weather');
  return res.json();
}

export async function fetchWeatherIsland() {
  const res = await fetch(`${API}/weather/island`);
  if (!res.ok) throw new Error('Failed to fetch island weather');
  return res.json();
}
