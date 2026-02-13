const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL not configured');
    }
    pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: { rejectUnauthorized: false },
    });
    pool.on('error', (err) => {
      console.error('[db] Unexpected pool error:', err.message);
    });
  }
  return pool;
}

function isConfigured() {
  return !!process.env.DATABASE_URL;
}

async function query(text, params) {
  return getPool().query(text, params);
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { getPool, query, close, isConfigured };
