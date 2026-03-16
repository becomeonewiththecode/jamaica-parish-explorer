import { fetchWithRetry } from './fetchWithRetry';

export async function fetchPortCruises(portId) {
  if (!portId) return { cruises: [] };
  const url = `/api/ports/${encodeURIComponent(portId)}/cruises`;
  const res = await fetchWithRetry(url);
  return res.json();
}

