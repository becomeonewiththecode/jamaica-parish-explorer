const db = require('./connection');

// Upsert a cruise port definition (by code) and return its row
function upsertCruisePort({ code, name, city, country = 'Jamaica', lat = null, lon = null, source_url = null }) {
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO cruise_ports (code, name, city, country, lat, lon, source_url, created_at, updated_at)
    VALUES (@code, @name, @city, @country, @lat, @lon, @source_url, @created_at, @updated_at)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name,
      city = excluded.city,
      country = excluded.country,
      lat = excluded.lat,
      lon = excluded.lon,
      source_url = excluded.source_url,
      updated_at = excluded.updated_at
  `);

  insert.run({ code, name, city, country, lat, lon, source_url, created_at: now, updated_at: now });
  return db.prepare('SELECT * FROM cruise_ports WHERE code = ?').get(code);
}

// Return stored cruise calls for a port (joined by code), ordered by ETA / local text
function getCruiseCallsForPort(portCode) {
  const sql = `
    SELECT c.*
    FROM cruise_calls c
    JOIN cruise_ports p ON c.port_id = p.id
    WHERE p.code = ?
    ORDER BY
      COALESCE(c.eta_utc, c.eta_local_text) ASC,
      c.created_at ASC
  `;
  return db.prepare(sql).all(portCode);
}

// Return the most recent updated_at timestamp for cruise calls at a port, or null
function getCruiseCallsLastUpdated(portCode) {
  const sql = `
    SELECT MAX(c.updated_at) AS lastUpdated
    FROM cruise_calls c
    JOIN cruise_ports p ON c.port_id = p.id
    WHERE p.code = ?
  `;
  const row = db.prepare(sql).get(portCode);
  return row && row.lastUpdated ? row.lastUpdated : null;
}

// Replace all scheduled cruise calls for a given port+source with a fresh list
function replaceCruiseCallsForPort(portCode, source, calls) {
  const port = db.prepare('SELECT * FROM cruise_ports WHERE code = ?').get(portCode);
  if (!port) {
    throw new Error(`Unknown cruise port code: ${portCode}`);
  }
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    // Remove existing scheduled calls from this source for this port
    db.prepare(
      `DELETE FROM cruise_calls WHERE port_id = ? AND source = ? AND (status = 'scheduled' OR status IS NULL)`
    ).run(port.id, source);

    if (!Array.isArray(calls) || calls.length === 0) return;

    const insert = db.prepare(`
      INSERT INTO cruise_calls (
        port_id,
        ship_name,
        operator,
        mmsi,
        source,
        eta_local_text,
        eta_utc,
        arrival_window_from,
        arrival_window_to,
        status,
        first_seen_at,
        last_seen_at,
        created_at,
        updated_at
      ) VALUES (
        @port_id,
        @ship_name,
        @operator,
        @mmsi,
        @source,
        @eta_local_text,
        @eta_utc,
        @arrival_window_from,
        @arrival_window_to,
        @status,
        @first_seen_at,
        @last_seen_at,
        @created_at,
        @updated_at
      )
    `);

    for (const c of calls) {
      insert.run({
        port_id: port.id,
        ship_name: c.shipName || c.ship_name,
        operator: c.operator || null,
        mmsi: c.mmsi || null,
        source,
        eta_local_text: c.etaLocalText || c.eta_local_text || null,
        eta_utc: c.etaUtc || c.eta_utc || null,
        arrival_window_from: c.arrivalWindowFrom || c.arrival_window_from || null,
        arrival_window_to: c.arrivalWindowTo || c.arrival_window_to || null,
        status: c.status || 'scheduled',
        first_seen_at: c.firstSeenAt || c.first_seen_at || null,
        last_seen_at: c.lastSeenAt || c.last_seen_at || null,
        created_at: now,
        updated_at: now,
      });
    }
  });

  tx();
}

// Record or update an observed call from AIS near a port
function upsertObservedCruiseCallFromAIS(portCode, { shipName, operator = null, mmsi = null, observedAt }) {
  const port = db.prepare('SELECT * FROM cruise_ports WHERE code = ?').get(portCode);
  if (!port) {
    throw new Error(`Unknown cruise port code: ${portCode}`);
  }
  const now = new Date().toISOString();

  const findExisting = db.prepare(`
    SELECT * FROM cruise_calls
    WHERE port_id = ? AND ship_name = ? AND source = 'AIS'
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const existing = findExisting.get(port.id, shipName);

  if (existing) {
    db.prepare(
      `UPDATE cruise_calls
       SET operator = COALESCE(operator, ?),
           mmsi = COALESCE(mmsi, ?),
           status = 'observed',
           last_seen_at = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(operator, mmsi, observedAt || now, now, existing.id);
    return existing.id;
  }

  const insert = db.prepare(`
    INSERT INTO cruise_calls (
      port_id,
      ship_name,
      operator,
      mmsi,
      source,
      status,
      first_seen_at,
      last_seen_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, 'AIS', 'observed', ?, ?, ?, ?)
  `);

  insert.run(port.id, shipName, operator, mmsi, observedAt || now, observedAt || now, now, now);
}

module.exports = {
  upsertCruisePort,
  getCruiseCallsForPort,
  getCruiseCallsLastUpdated,
  replaceCruiseCallsForPort,
  upsertObservedCruiseCallFromAIS,
};

