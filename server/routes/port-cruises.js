const express = require('express');
const cheerio = require('cheerio');
const {
  upsertCruisePort,
  getCruiseCallsForPort,
  getCruiseCallsLastUpdated,
  replaceCruiseCallsForPort,
} = require('../db/cruise-schedules');

const router = express.Router();

// Map port IDs used by the client to external schedule URLs
const PORT_SCHEDULE_URLS = {
  'montego-bay-cruise-port': 'https://cruisedig.com/ports/montego-bay-jamaica',
  'ocho-rios-cruise-port': 'https://cruisedig.com/ports/ocho-rios-jamaica',
  'falmouth-cruise-port': 'https://www.cruisemapper.com/ports/falmouth-port-4261',
};

// How long we consider stored cruise schedules "fresh" before re-scraping
const SCHEDULE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

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

  // 1) Prefer data already stored in the database (map reads from DB going forward)
  try {
    const lastUpdated = getCruiseCallsLastUpdated(portId);
    if (lastUpdated) {
      const ageMs = Date.now() - Date.parse(lastUpdated);
      if (!Number.isNaN(ageMs) && ageMs < SCHEDULE_TTL_MS) {
        const rows = getCruiseCallsForPort(portId);
        if (rows && rows.length) {
          return rows.map((r) => ({
            shipName: r.ship_name,
            operator: r.operator,
            etaLocalText: r.eta_local_text,
            source: r.source,
          }));
        }
      }
    }
  } catch (e) {
    console.warn(`[PortCruises] Failed to read cached schedules from DB for ${portId}:`, e.message);
  }

  // 2) Fallback: scrape fresh data from CruiseDig / CruiseMapper and persist it
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

    // Persist schedules to the cruise_schedules tables
    const portMeta = {
      'montego-bay-cruise-port': { name: 'Montego Bay Cruise Port', city: 'Montego Bay' },
      'ocho-rios-cruise-port': { name: 'Ocho Rios Cruise Port', city: 'Ocho Rios' },
      'falmouth-cruise-port': { name: 'Falmouth Cruise Port', city: 'Falmouth' },
    }[portId] || { name: portId, city: null };

    const portRow = upsertCruisePort({
      code: portId,
      name: portMeta.name,
      city: portMeta.city,
      lat: null,
      lon: null,
      source_url: url,
    });

    const inferredSource = data[0]?.source || (url.includes('cruisedig.com') ? 'CruiseDig' : 'CruiseMapper');
    replaceCruiseCallsForPort(portRow.code, inferredSource, data);

    return data;
  } catch (e) {
    console.warn(`[PortCruises] Failed to fetch schedule for ${portId}:`, e.message);
    // If scraping fails and DB has something (even stale), fall back to DB contents
    try {
      const rows = getCruiseCallsForPort(portId);
      if (rows && rows.length) {
        return rows.map((r) => ({
          shipName: r.ship_name,
          operator: r.operator,
          etaLocalText: r.eta_local_text,
          source: r.source,
        }));
      }
    } catch (inner) {
      console.warn(`[PortCruises] Also failed to read fallback schedules from DB for ${portId}:`, inner.message);
    }
    return [];
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

