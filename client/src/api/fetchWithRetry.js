/**
 * Fetch with retry on failure. Retries on network errors or non-ok response.
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {number} [retries=3] - number of retries after the first attempt
 * @param {number} [delayMs=1000] - initial delay between retries (doubles each time, capped at 10s)
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}, retries = 3, delayMs = 1000) {
  let lastError;
  let attempt = 0;
  const maxAttempts = retries + 1;

  while (attempt < maxAttempts) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      lastError = new Error(`HTTP ${res.status}: ${res.statusText}`);
    } catch (err) {
      lastError = err;
    }
    attempt++;
    if (attempt >= maxAttempts) break;
    await new Promise((r) => setTimeout(r, delayMs));
    delayMs = Math.min(delayMs * 2, 10000);
  }

  throw lastError;
}
