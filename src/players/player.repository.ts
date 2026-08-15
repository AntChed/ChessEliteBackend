import { randomUUID } from 'node:crypto';

import { pool } from '../db/pool.js';
import type { Player } from './player.types.js';

type PlayerRow = {
  created_at: Date;
  id: string;
  last_seen_at: Date | null;
  nickname: string;
  token_version: number;
  updated_at: Date;
};

function requirePool() {
  if (!pool) {
    throw new Error('DATABASE_URL is required');
  }

  return pool;
}

function toPlayer(row: PlayerRow): Player {
  return {
    createdAt: row.created_at,
    id: row.id,
    lastSeenAt: row.last_seen_at,
    nickname: row.nickname,
    tokenVersion: row.token_version,
    updatedAt: row.updated_at,
  };
}

export async function createAnonymousPlayer(nickname: string): Promise<Player> {
  const result = await requirePool().query<PlayerRow>(
    `
      INSERT INTO players (id, nickname)
      VALUES ($1, $2)
      RETURNING id, nickname, token_version, created_at, updated_at, last_seen_at
    `,
    [randomUUID(), nickname],
  );

  return toPlayer(result.rows[0]);
}

export async function findPlayerById(playerId: string): Promise<Player | null> {
  const result = await requirePool().query<PlayerRow>(
    `
      SELECT id, nickname, token_version, created_at, updated_at, last_seen_at
      FROM players
      WHERE id = $1
    `,
    [playerId],
  );

  return result.rows[0] ? toPlayer(result.rows[0]) : null;
}

export async function updatePlayerNickname(playerId: string, nickname: string): Promise<Player | null> {
  const result = await requirePool().query<PlayerRow>(
    `
      UPDATE players
      SET nickname = $2,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, nickname, token_version, created_at, updated_at, last_seen_at
    `,
    [playerId, nickname],
  );

  return result.rows[0] ? toPlayer(result.rows[0]) : null;
}

export async function touchPlayerLastSeen(playerId: string): Promise<void> {
  await requirePool().query(
    `
      UPDATE players
      SET last_seen_at = NOW()
      WHERE id = $1
    `,
    [playerId],
  );
}

