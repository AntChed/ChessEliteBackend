import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { closeDatabasePool, pool } from './pool.js';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFilePath);
const migrationsDirectory = path.join(currentDirectory, 'migrations');

type MigrationFile = {
  name: string;
  path: string;
};

async function ensureMigrationTable() {
  if (!pool) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrationNames() {
  if (!pool) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  const result = await pool.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name ASC');

  return new Set(result.rows.map((row) => row.name));
}

async function listMigrationFiles(): Promise<MigrationFile[]> {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => ({
      name: entry.name,
      path: path.join(migrationsDirectory, entry.name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function applyMigration(migration: MigrationFile) {
  if (!pool) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  const sql = await readFile(migration.path, 'utf8');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
    await client.query('COMMIT');
    console.log(
      JSON.stringify({
        event: 'MIGRATION_APPLIED',
        migration: migration.name,
      }),
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function migrate() {
  await ensureMigrationTable();

  const appliedMigrationNames = await getAppliedMigrationNames();
  const migrations = await listMigrationFiles();
  const pendingMigrations = migrations.filter((migration) => !appliedMigrationNames.has(migration.name));

  if (pendingMigrations.length === 0) {
    console.log(JSON.stringify({ event: 'MIGRATIONS_UP_TO_DATE' }));
    return;
  }

  for (const migration of pendingMigrations) {
    await applyMigration(migration);
  }
}

migrate()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDatabasePool().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  });

