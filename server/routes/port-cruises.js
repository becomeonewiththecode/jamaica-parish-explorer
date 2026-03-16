const express = require('express');
const cheerio = require('cheerio');

const router = express.Router();

// Map port IDs used by the client to external schedule URLs
const PORT_SCHEDULE_URLS = {
  'montego-bay-cruise-port': 'https://cruisedig.com/ports/montego-bay-jamaica',
  'ocho-rios-cruise-port': 'https://cruisedig.com/ports/ocho-rios-jamaica',
  'falmouth-cruise-port': 'https://www.cruisemapper.com/ports/falmouth-port-4261',
};

// Simple in-memory cache: { [portId]: { data, fetchedAt } }
const cache = {};
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'JamaicaParishExplorer/1.0' } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.text();
}

// Very simple HTML parsing tailored to current CruiseDig / CruiseMapper layouts.
function parseCruiseDig(html) {
  const $ = cheerio.load(html);
  const rows = [];

  $('table tbody tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 3) return;
    const etaText = $(tds[0]).text().trim(); // date/time
    const shipName = $(tds[1]).text().trim();
    const operator = $(tds[2]).text().trim();
    if (!shipName) return;
    rows.push({
      shipName,
      operator: operator || null,
      etaLocalText: etaText || null,
      source: 'CruiseDig',
    });
  });

  return rows;
}

function parseCruiseMapper(html) {
  const $ = cheerio.load(html);
  const rows = [];

  $('table tbody tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 3) return;
    const etaText = $(tds[0]).text().trim();
    const shipName = $(tds[1]).text().trim();
    const operator = $(tds[2]).text().trim();
    if (!shipName) return;
    rows.push({
      shipName,
      operator: operator || null,
      etaLocalText: etaText || null,
      source: 'CruiseMapper',
    });
  });

  return rows;
}

async function loadPortCruises(portId) {
  const url = PORT_SCHEDULE_URLS[portId];
  if (!url) return [];

  const now = Date.now();
  const cached = cache[portId];
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const html = await fetchHtml(url);
    let data;
    if (url.includes('cruisedig.com')) {
      data = parseCruiseDig(html);
    } else if (url.includes('cruisemapper.com')) {
      data = parseCruiseMapper(html);
    } else {
      data = [];
    }
    cache[portId] = { data, fetchedAt: now };
    return data;
  } catch (e) {
    console.warn(`[PortCruises] Failed to fetch schedule for ${portId}:`, e.message);
    return cached?.data || [];
  }
}

// GET /api/ports/:id/cruises — upcoming cruise calls for a port
router.get('/:id/cruises', async (req, res) => {
  const portId = req.params.id;
  if (!PORT_SCHEDULE_URLS[portId]) {
    return res.status(404).json({ error: 'Unknown port id' });
  }
  const list = await loadPortCruises(portId);
  res.json({ portId, cruises: list });
});

module.exports = router;

