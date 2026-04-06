const { Pool } = require('pg');

let pool;

/**
 * Connection string: use DATABASE_URL if set, otherwise build from POSTGRES_* (.env friendly).
 * @see deployment/docker-compose/.env.example
 */
function resolveDatabaseUrl() {
  const direct = process.env.DATABASE_URL;
  if (direct && String(direct).trim()) {
    return String(direct).trim();
  }
  const user = process.env.POSTGRES_USER || 'jamaica';
  const password = process.env.POSTGRES_PASSWORD || 'jamaica';
  const host = process.env.POSTGRES_HOST || '127.0.0.1';
  const port = process.env.POSTGRES_PORT || '5432';
  const db = process.env.POSTGRES_DB || 'jamaica';
  const u = encodeURIComponent(user);
  const p = encodeURIComponent(password);
  return `postgresql://${u}:${p}@${host}:${port}/${db}`;
}

function getPool() {
  if (!pool) {
    const url = resolveDatabaseUrl();
    pool = new Pool({
      connectionString: url,
      max: Number(process.env.PG_POOL_MAX) || 20,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

/** Convert SQLite-style ? placeholders to PostgreSQL $1, $2, … */
function toPgSql(sql) {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

/**
 * @param {string} sql
 * @param {unknown[]} [params]
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(sql, params = []) {
  const text = sql.includes('?') ? toPgSql(sql) : sql;
  return getPool().query(text, params);
}

/**
 * @param {(client: import('pg').PoolClient) => Promise<void>} fn
 */
async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await fn(client);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** @param {import('pg').PoolClient} client */
async function clientQuery(client, sql, params = []) {
  const text = sql.includes('?') ? toPgSql(sql) : sql;
  return client.query(text, params);
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

module.exports = {
  getPool,
  resolveDatabaseUrl,
  query,
  withTransaction,
  clientQuery,
  toPgSql,
  closePool,
};
