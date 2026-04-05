const { query, withTransaction, clientQuery } = require('./pg-query');

// Upsert a cruise port definition (by code) and return its row
async function upsertCruisePort({
  code,
  name,
  city,
  country = 'Jamaica',
  lat = null,
  lon = null,
  source_url = null,
}) {
  const now = new Date().toISOString();
  await query(
    `
    INSERT INTO cruise_ports (code, name, city, country, lat, lon, source_url, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (code) DO UPDATE SET
      name = EXCLUDED.name,
      city = EXCLUDED.city,
      country = EXCLUDED.country,
      lat = EXCLUDED.lat,
      lon = EXCLUDED.lon,
      source_url = EXCLUDED.source_url,
      updated_at = EXCLUDED.updated_at
  `,
    [code, name, city, country, lat, lon, source_url, now, now]
  );
  const r = await query('SELECT * FROM cruise_ports WHERE code = $1', [code]);
  return r.rows[0];
}

// Return stored cruise calls for a port (joined by code), ordered by ETA / local text
async function getCruiseCallsForPort(portCode) {
  const sql = `
    SELECT c.*
    FROM cruise_calls c
    JOIN cruise_ports p ON c.port_id = p.id
    WHERE p.code = $1
    ORDER BY
      COALESCE(c.eta_utc, c.eta_local_text) ASC,
      c.created_at ASC
  `;
  const r = await query(sql, [portCode]);
  return r.rows;
}

// Return the most recent updated_at timestamp for cruise calls at a port, or null
async function getCruiseCallsLastUpdated(portCode) {
  const sql = `
    SELECT MAX(c.updated_at) AS lastUpdated
    FROM cruise_calls c
    JOIN cruise_ports p ON c.port_id = p.id
    WHERE p.code = $1
  `;
  const r = await query(sql, [portCode]);
  const row = r.rows[0];
  return row && row.lastupdated ? row.lastupdated : null;
}

// Replace all scheduled cruise calls for a given port+source with a fresh list
async function replaceCruiseCallsForPort(portCode, source, calls) {
  const pr = await query('SELECT * FROM cruise_ports WHERE code = $1', [portCode]);
  const port = pr.rows[0];
  if (!port) {
    throw new Error(`Unknown cruise port code: ${portCode}`);
  }
  const now = new Date().toISOString();

  await withTransaction(async (client) => {
    await clientQuery(
      client,
      `DELETE FROM cruise_calls WHERE port_id = $1 AND source = $2 AND (status = 'scheduled' OR status IS NULL)`,
      [port.id, source]
    );

    if (!Array.isArray(calls) || calls.length === 0) return;

    const insertSql = `
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
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
      )
    `;

    for (const c of calls) {
      await clientQuery(client, insertSql, [
        port.id,
        c.shipName || c.ship_name,
        c.operator || null,
        c.mmsi || null,
        source,
        c.etaLocalText || c.eta_local_text || null,
        c.etaUtc || c.eta_utc || null,
        c.arrivalWindowFrom || c.arrival_window_from || null,
        c.arrivalWindowTo || c.arrival_window_to || null,
        c.status || 'scheduled',
        c.firstSeenAt || c.first_seen_at || null,
        c.lastSeenAt || c.last_seen_at || null,
        now,
        now,
      ]);
    }
  });
}

// Record or update an observed call from AIS near a port
async function upsertObservedCruiseCallFromAIS(portCode, { shipName, operator = null, mmsi = null, observedAt }) {
  const pr = await query('SELECT * FROM cruise_ports WHERE code = $1', [portCode]);
  const port = pr.rows[0];
  if (!port) {
    throw new Error(`Unknown cruise port code: ${portCode}`);
  }
  const now = new Date().toISOString();

  const findR = await query(
    `
    SELECT * FROM cruise_calls
    WHERE port_id = $1 AND ship_name = $2 AND source = 'AIS'
    ORDER BY created_at DESC
    LIMIT 1
  `,
    [port.id, shipName]
  );
  const existing = findR.rows[0];

  if (existing) {
    await query(
      `UPDATE cruise_calls
       SET operator = COALESCE(operator, $1),
           mmsi = COALESCE(mmsi, $2),
           status = 'observed',
           last_seen_at = $3,
           updated_at = $4
       WHERE id = $5`,
      [operator, mmsi, observedAt || now, now, existing.id]
    );
    return existing.id;
  }

  const ins = await query(
    `
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
    ) VALUES ($1, $2, $3, $4, 'AIS', 'observed', $5, $6, $7, $8)
    RETURNING id
  `,
    [port.id, shipName, operator, mmsi, observedAt || now, observedAt || now, now, now]
  );
  return ins.rows[0].id;
}

module.exports = {
  upsertCruisePort,
  getCruiseCallsForPort,
  getCruiseCallsLastUpdated,
  replaceCruiseCallsForPort,
  upsertObservedCruiseCallFromAIS,
};
