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
// CruiseMapper is treated as the primary source for all ports,
// with CruiseDig used as a complementary source where available.
const PRIMARY_PORT_URLS = {
  'montego-bay-cruise-port': 'https://www.cruisemapper.com/ports/montego-bay-port-790',
  'ocho-rios-cruise-port': 'https://www.cruisemapper.com/ports/ocho-rios-port-708',
  // Falmouth: CruiseMapper returns 403 from this server, so we use CruiseDig as primary
  'falmouth-cruise-port': 'https://cruisedig.com/ports/falmouth-jamaica',
};

const SECONDARY_PORT_URLS = {
  'montego-bay-cruise-port': 'https://cruisedig.com/ports/montego-bay-jamaica',
  'ocho-rios-cruise-port': 'https://cruisedig.com/ports/ocho-rios-jamaica',
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

  // Newer CruiseDig layouts (including Falmouth) render arrivals as list items:
  // <div class="schedule">
  //   <div class="schedule__ship">
  //     <div class="name"><a>Adventure Of The Seas</a></div>
  //     <div class="occupancy"><a>Royal Caribbean</a></div>
  //     <div class="occupancy">4.058 passengers</div>
  //   </div>
  //   <div class="schedule__datetime">17 Mar 2026 - <span data-time="09:30"><span>09:30</span></span></div>
  // </div>
  //
  // We target this structure directly.

  $('.view-port-schedule-arrivals .list-group-item').each((_, li) => {
    const el = $(li);
    const shipName = el.find('.schedule__ship .name a').first().text().trim();
    const operator = el.find('.schedule__ship .occupancy a').first().text().trim();
    const dateText = el.find('.schedule__datetime').first().contents().first().text().trim(); // e.g. "17 Mar 2026 -"
    const timeText = el.find('.schedule__datetime [data-time]').first().attr('data-time') || '';
    const etaLocalText = (dateText + ' ' + timeText).replace(/\s+-\s*$/, '').trim();

    if (!shipName || !etaLocalText) return;

    rows.push({
      shipName,
      operator: operator || null,
      etaLocalText,
      source: 'CruiseDig',
    });
  });

  // Fallback: legacy table-based layout
  if (rows.length === 0) {
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
  }

  return rows;
}

function parseCruiseMapper(html) {
  const $ = cheerio.load(html);
  const rows = [];

  $('table tbody tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 1) return;

    // CruiseMapper schedules currently use:
    // td[0] = ship name, td[1] = arrival time, td[2] = departure time.
    // Older layouts might have td[0] as date/time and td[1] as ship name.
    const col0 = $(tds[0]).text().trim();
    const col1 = tds[1] ? $(tds[1]).text().trim() : '';
    const col2 = tds[2] ? $(tds[2]).text().trim() : '';

    const timeLike = (val) => /^(\d{1,2}:\d{2})$/.test(val);

    let shipName;
    let etaLocalText;
    let operator = null;

    if (col0 && timeLike(col1)) {
      // New layout: Ship | Arrival | Departure
      shipName = col0;
      etaLocalText = col1 && col2 ? `${col1}–${col2}` : col1 || col2 || null;
    } else {
      // Fallback to older assumption: Date/ETA | Ship | Operator
      const fallbackEta = col0 || null;
      const fallbackShip = col1 || '';
      const fallbackOp = col2 || '';
      shipName = fallbackShip;
      etaLocalText = fallbackEta;
      operator = fallbackOp || null;
    }

    if (!shipName) return;
    if (!operator && col2 && !timeLike(col2)) {
      operator = col2;
    }

    rows.push({
      shipName,
      operator: operator || null,
      etaLocalText: etaLocalText || null,
      source: 'CruiseMapper',
    });
  });

  return rows;
}

async function loadPortCruises(portId) {
  const primaryUrl = PRIMARY_PORT_URLS[portId];
  if (!primaryUrl) return [];

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

  // 2) Fallback: scrape fresh data, preferring the primary source and optionally merging the secondary
  try {
    // Primary: CruiseMapper or CruiseDig depending on URL
    const primaryHtml = await fetchHtml(primaryUrl);
    let primaryData = [];
    if (primaryHtml) {
      if (primaryUrl.includes('cruisedig.com')) {
        primaryData = parseCruiseDig(primaryHtml);
      } else {
        primaryData = parseCruiseMapper(primaryHtml);
      }
    }

    // Secondary: CruiseDig (complementary) where configured
    let secondaryData = [];
    const secondaryUrl = SECONDARY_PORT_URLS[portId];
    if (secondaryUrl) {
      try {
        const secondaryHtml = await fetchHtml(secondaryUrl);
        if (secondaryHtml) {
          secondaryData = parseCruiseDig(secondaryHtml);
        }
      } catch (secondaryErr) {
        console.warn(`[PortCruises] Failed to fetch secondary schedule for ${portId}:`, secondaryErr.message);
      }
    }

    // Merge primary/secondary lists and de‑duplicate by (shipName, etaLocalText, source)
    const combined = [...primaryData, ...secondaryData];
    const seen = new Set();
    const data = combined.filter((row) => {
      const key = `${row.shipName || ''}|${row.etaLocalText || ''}|${row.source || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

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
      source_url: primaryUrl,
    });

    // Persist schedules to the cruise_schedules tables, grouped by source
    const bySource = data.reduce((acc, row) => {
      const src = row.source || 'Unknown';
      if (!acc[src]) acc[src] = [];
      acc[src].push(row);
      return acc;
    }, {});

    for (const [source, rows] of Object.entries(bySource)) {
      replaceCruiseCallsForPort(portRow.code, source, rows);
    }

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
/**
 * @swagger
 * /ports/{id}/cruises:
 *   get:
 *     summary: Cruise schedule for a port
 *     description: Returns upcoming cruise ship calls for a Jamaican port. Data is scraped and cached for 6 hours.
 *     tags: [Cruises]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           enum: [montego-bay-cruise-port, ocho-rios-cruise-port, falmouth-cruise-port]
 *         description: Port identifier
 *     responses:
 *       200:
 *         description: "{ portId: string, cruises: array }"
 *       404:
 *         description: Unknown port id
 */
router.get('/:id/cruises', async (req, res) => {
  const portId = req.params.id;
  if (!PRIMARY_PORT_URLS[portId]) {
    return res.status(404).json({ error: 'Unknown port id' });
  }
  const list = await loadPortCruises(portId);
  res.json({ portId, cruises: list });
});

module.exports = router;

