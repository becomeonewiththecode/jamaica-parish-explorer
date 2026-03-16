const express = require('express');
const WebSocket = require('ws');

const router = express.Router();

const AISSTREAM_API_KEY = process.env.AISSTREAM_API_KEY || process.env.AISSTREAM_KEY || '';

// Jamaica bounding box (lon/lat) with a bit of buffer for nearby traffic
// [ [lonMin, latMin], [lonMax, latMax] ]
const JAMAICA_BBOX = [
  [-79.5, 17.2],
  [-75.5, 19.2],
];

// In‑memory cache of recent vessel positions
let vesselsCache = [];
let lastSnapshotTs = 0;

// Keep positions seen in the last N ms
const VESSEL_TTL_MS = 30 * 60 * 1000; // 30 minutes

function upsertVesselFromMessage(msg) {
  if (!msg || msg.MessageType !== 'PositionReport') return;
  const p = msg.Message?.PositionReport;
  if (!p) return;

  const lat = Number(p.Latitude);
  const lon = Number(p.Longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

  const mmsi = String(p.UserID || '');
  if (!mmsi) return;

  const now = Date.now();

  // Optional metadata from static reports when available
  const staticMsg = msg.StaticData || {};
  const name = (staticMsg.ShipName || '').trim();
  const shipType = (staticMsg.ShipType || '').toString();

  let found = false;
  for (let i = 0; i < vesselsCache.length; i++) {
    if (vesselsCache[i].mmsi === mmsi) {
      vesselsCache[i] = {
        ...vesselsCache[i],
        lat,
        lon,
        heading: p.TrueHeading != null ? Number(p.TrueHeading) : vesselsCache[i].heading ?? 0,
        sog: p.Sog != null ? Number(p.Sog) : vesselsCache[i].sog ?? 0,
        cog: p.Cog != null ? Number(p.Cog) : vesselsCache[i].cog ?? 0,
        name: name || vesselsCache[i].name,
        shipType: shipType || vesselsCache[i].shipType,
        lastSeen: now,
      };
      found = true;
      break;
    }
  }

  if (!found) {
    vesselsCache.push({
      mmsi,
      lat,
      lon,
      heading: p.TrueHeading != null ? Number(p.TrueHeading) : 0,
      sog: p.Sog != null ? Number(p.Sog) : 0,
      cog: p.Cog != null ? Number(p.Cog) : 0,
      name: name || '',
      shipType,
      lastSeen: now,
    });
  }
}

function cleanupVessels() {
  const cutoff = Date.now() - VESSEL_TTL_MS;
  vesselsCache = vesselsCache.filter(v => v.lastSeen >= cutoff);
}

let socket;
let socketConnecting = false;

function ensureAisStream() {
  if (!AISSTREAM_API_KEY) {
    if (!socketConnecting && !socket) {
      console.warn('[Vessels] AISSTREAM_API_KEY not set; vessel traffic disabled.');
    }
    return;
  }
  if (socket || socketConnecting) return;
  socketConnecting = true;

  socket = new WebSocket('wss://stream.aisstream.io/v0/stream');

  socket.on('open', () => {
    socketConnecting = false;
    const subscriptionMessage = {
      APIkey: AISSTREAM_API_KEY,
      BoundingBoxes: [JAMAICA_BBOX],
    };
    socket.send(JSON.stringify(subscriptionMessage));
    console.log('[Vessels] Connected to aisstream.io and subscribed to Jamaica bounding box.');
  });

  socket.on('message', (event) => {
    try {
      const msg = JSON.parse(event.toString());
      upsertVesselFromMessage(msg);
    } catch (_) {
      // ignore malformed messages
    }
  });

  socket.on('close', () => {
    console.warn('[Vessels] AIS stream closed; retrying in 10s.');
    socket = null;
    setTimeout(ensureAisStream, 10000);
  });

  socket.on('error', (err) => {
    console.error('[Vessels] AIS stream error:', err.message);
    try {
      socket.close();
    } catch (_) {}
  });
}

// Periodic cleanup
setInterval(cleanupVessels, 5 * 60 * 1000);

// GET /api/vessels — snapshot of recent vessels near Jamaica
router.get('/', (req, res) => {
  ensureAisStream();
  cleanupVessels();

  const now = Date.now();
  lastSnapshotTs = now;

  const typeFilter = (req.query.type || 'all').toLowerCase();
  let list = vesselsCache;
  if (typeFilter === 'cruise') {
    // crude heuristic: passenger ship types OR cruise line names
    list = list.filter(v => {
      const name = (v.name || '').toLowerCase();
      const type = (v.shipType || '').toLowerCase();
      return (
        type.includes('passenger') ||
        name.includes('carnival') ||
        name.includes('royal') ||
        name.includes('msc') ||
        name.includes('norwegian') ||
        name.includes('cruise')
      );
    });
  }

  const payload = list.map(v => ({
    mmsi: v.mmsi,
    name: v.name || null,
    shipType: v.shipType || null,
    lat: v.lat,
    lon: v.lon,
    heading: v.heading,
    sog: v.sog,
    cog: v.cog,
    lastSeen: v.lastSeen,
  }));

  res.json({
    vessels: payload,
    time: Math.floor(now / 1000),
    bbox: {
      lonMin: JAMAICA_BBOX[0][0],
      latMin: JAMAICA_BBOX[0][1],
      lonMax: JAMAICA_BBOX[1][0],
      latMax: JAMAICA_BBOX[1][1],
    },
  });
});

module.exports = router;

