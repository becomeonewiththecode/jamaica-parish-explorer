import { fetchWithRetry } from './fetchWithRetry';

export async function fetchVessels(type = 'all') {
  const params = new URLSearchParams();
  if (type && type !== 'all') params.set('type', type);
  const query = params.toString();
  const url = `/api/vessels${query ? `?${query}` : ''}`;
  return fetchWithRetry(url);
}

