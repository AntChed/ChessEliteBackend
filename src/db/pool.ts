import pg from 'pg';

import { env } from '../config/env.js';

const { Pool } = pg;

export const pool = env.databaseUrl
  ? new Pool({
      connectionString: env.databaseUrl,
      max: 10,
    })
  : null;

export async function checkDatabaseConnection() {
  if (!pool) {
    return 'not_configured' as const;
  }

  const client = await pool.connect();

  try {
    await client.query('SELECT 1');

    return 'ok' as const;
  } finally {
    client.release();
  }
}

export async function closeDatabasePool() {
  if (pool) {
    await pool.end();
  }
}

