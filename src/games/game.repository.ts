import { randomUUID } from 'node:crypto';

import { Chess } from 'chess.js';
import type { PoolClient } from 'pg';

import { pool } from '../db/pool.js';
import { createJoinCode } from './joinCode.js';
import type { Game, GameResult, GameStatus } from './game.types.js';

const initialFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const maxJoinCodeAttempts = 8;

type GameRow = {
  black_nickname: string | null;
  black_player_id: string | null;
  created_at: Date;
  fen: string;
  id: string;
  join_code: string;
  result: GameResult | null;
  status: GameStatus;
  updated_at: Date;
  version: number;
  white_nickname: string;
  white_player_id: string;
  winner_player_id: string | null;
};

export type JoinGameResult =
  | { game: Game; status: 'joined' }
  | { status: 'already_participant' }
  | { status: 'full' }
  | { status: 'not_found' }
  | { status: 'not_waiting' };

export type PlayMoveInput = {
  from: string;
  moveId: string;
  promotion?: 'b' | 'n' | 'q' | 'r';
  to: string;
};

export type PlayedMove = {
  id: string;
  san: string;
};

export type PlayMoveResult =
  | { game: Game; move: PlayedMove; status: 'duplicate' | 'played' }
  | { status: 'duplicate_move_id' }
  | { status: 'invalid_move' }
  | { status: 'not_active' }
  | { status: 'not_found' }
  | { status: 'not_participant' }
  | { status: 'not_turn' };

export type ResignGameResult =
  | { game: Game; status: 'resigned' }
  | { status: 'not_active' }
  | { status: 'not_found' }
  | { status: 'not_participant' };

type ExistingMoveRow = {
  game_id: string;
  move_id: string;
  player_id: string;
  san: string | null;
};

type LockedGameRow = {
  black_player_id: string | null;
  fen: string;
  id: string;
  status: GameStatus;
  white_player_id: string;
};

function requirePool() {
  if (!pool) {
    throw new Error('DATABASE_URL is required');
  }

  return pool;
}

function toGame(row: GameRow): Game {
  return {
    black: row.black_player_id
      ? {
          id: row.black_player_id,
          nickname: row.black_nickname ?? 'Player',
        }
      : null,
    blackPlayerId: row.black_player_id,
    createdAt: row.created_at,
    fen: row.fen,
    id: row.id,
    joinCode: row.join_code,
    result: row.result,
    status: row.status,
    updatedAt: row.updated_at,
    version: row.version,
    white: {
      id: row.white_player_id,
      nickname: row.white_nickname,
    },
    whitePlayerId: row.white_player_id,
    winnerPlayerId: row.winner_player_id,
  };
}

async function fetchGameById(client: PoolClient, gameId: string) {
  const result = await client.query<GameRow>(
    `
      SELECT
        g.id,
        g.join_code,
        g.white_player_id,
        white_player.nickname AS white_nickname,
        g.black_player_id,
        black_player.nickname AS black_nickname,
        g.status,
        g.fen,
        g.version,
        g.winner_player_id,
        g.result,
        g.created_at,
        g.updated_at
      FROM games g
      INNER JOIN players white_player ON white_player.id = g.white_player_id
      LEFT JOIN players black_player ON black_player.id = g.black_player_id
      WHERE g.id = $1
    `,
    [gameId],
  );

  return result.rows[0] ? toGame(result.rows[0]) : null;
}

async function fetchExistingMove(client: PoolClient, moveId: string) {
  const result = await client.query<ExistingMoveRow>(
    `
      SELECT move_id, game_id, player_id, san
      FROM moves
      WHERE move_id = $1
    `,
    [moveId],
  );

  return result.rows[0] ?? null;
}

async function resolveDuplicateMove(
  client: PoolClient,
  existingMove: ExistingMoveRow,
  gameId: string,
  playerId: string,
): Promise<PlayMoveResult> {
  if (existingMove.game_id !== gameId || existingMove.player_id !== playerId) {
    return { status: 'duplicate_move_id' };
  }

  const game = await fetchGameById(client, existingMove.game_id);

  if (!game) {
    return { status: 'not_found' };
  }

  return {
    game,
    move: {
      id: existingMove.move_id,
      san: existingMove.san ?? '',
    },
    status: 'duplicate',
  };
}

export async function createGame(whitePlayerId: string): Promise<Game> {
  const databasePool = requirePool();

  for (let attempt = 0; attempt < maxJoinCodeAttempts; attempt += 1) {
    const client = await databasePool.connect();

    try {
      await client.query('BEGIN');

      const insertResult = await client.query<{ id: string }>(
        `
          INSERT INTO games (id, join_code, white_player_id, status, fen)
          VALUES ($1, $2, $3, 'WAITING', $4)
          RETURNING id
        `,
        [randomUUID(), createJoinCode(), whitePlayerId, initialFen],
      );

      const game = await fetchGameById(client, insertResult.rows[0].id);

      if (!game) {
        throw new Error('Created game could not be loaded');
      }

      await client.query('COMMIT');
      return game;
    } catch (error) {
      await client.query('ROLLBACK');

      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        continue;
      }

      throw error;
    } finally {
      client.release();
    }
  }

  throw new Error('Could not generate a unique join code');
}

export async function findGameById(gameId: string): Promise<Game | null> {
  const client = await requirePool().connect();

  try {
    return await fetchGameById(client, gameId);
  } finally {
    client.release();
  }
}

export async function joinGameByCode(joinCode: string, playerId: string): Promise<JoinGameResult> {
  const client = await requirePool().connect();

  try {
    await client.query('BEGIN');

    const lockedGameResult = await client.query<{
      black_player_id: string | null;
      id: string;
      status: GameStatus;
      white_player_id: string;
    }>(
      `
        SELECT id, white_player_id, black_player_id, status
        FROM games
        WHERE join_code = $1
        FOR UPDATE
      `,
      [joinCode],
    );

    const lockedGame = lockedGameResult.rows[0];

    if (!lockedGame) {
      await client.query('ROLLBACK');
      return { status: 'not_found' };
    }

    if (lockedGame.white_player_id === playerId || lockedGame.black_player_id === playerId) {
      await client.query('ROLLBACK');
      return { status: 'already_participant' };
    }

    if (lockedGame.status !== 'WAITING') {
      await client.query('ROLLBACK');
      return { status: 'not_waiting' };
    }

    if (lockedGame.black_player_id) {
      await client.query('ROLLBACK');
      return { status: 'full' };
    }

    await client.query(
      `
        UPDATE games
        SET black_player_id = $2,
            status = 'ACTIVE',
            started_at = NOW(),
            updated_at = NOW(),
            version = version + 1
        WHERE id = $1
      `,
      [lockedGame.id, playerId],
    );

    const game = await fetchGameById(client, lockedGame.id);

    if (!game) {
      throw new Error('Joined game could not be loaded');
    }

    await client.query('COMMIT');
    return { game, status: 'joined' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function playMove(gameId: string, playerId: string, input: PlayMoveInput): Promise<PlayMoveResult> {
  const client = await requirePool().connect();

  try {
    await client.query('BEGIN');

    const existingMoveBeforeLock = await fetchExistingMove(client, input.moveId);

    if (existingMoveBeforeLock) {
      const result = await resolveDuplicateMove(client, existingMoveBeforeLock, gameId, playerId);
      await client.query('ROLLBACK');
      return result;
    }

    const lockedGameResult = await client.query<LockedGameRow>(
      `
        SELECT id, white_player_id, black_player_id, status, fen
        FROM games
        WHERE id = $1
        FOR UPDATE
      `,
      [gameId],
    );

    const lockedGame = lockedGameResult.rows[0];

    if (!lockedGame) {
      await client.query('ROLLBACK');
      return { status: 'not_found' };
    }

    const existingMoveAfterLock = await fetchExistingMove(client, input.moveId);

    if (existingMoveAfterLock) {
      const result = await resolveDuplicateMove(client, existingMoveAfterLock, gameId, playerId);
      await client.query('ROLLBACK');
      return result;
    }

    const playerColor =
      lockedGame.white_player_id === playerId ? 'white' : lockedGame.black_player_id === playerId ? 'black' : null;

    if (!playerColor) {
      await client.query('ROLLBACK');
      return { status: 'not_participant' };
    }

    if (lockedGame.status !== 'ACTIVE') {
      await client.query('ROLLBACK');
      return { status: 'not_active' };
    }

    const turn = lockedGame.fen.split(' ')[1] === 'b' ? 'black' : 'white';

    if (turn !== playerColor) {
      await client.query('ROLLBACK');
      return { status: 'not_turn' };
    }

    const chess = new Chess(lockedGame.fen);
    let moveResult;

    try {
      moveResult = chess.move({
        from: input.from,
        promotion: input.promotion,
        to: input.to,
      });
    } catch {
      moveResult = null;
    }

    if (!moveResult) {
      await client.query('ROLLBACK');
      return { status: 'invalid_move' };
    }

    const fenAfter = chess.fen();
    let nextStatus: GameStatus = 'ACTIVE';
    let result: GameResult | null = null;
    let winnerPlayerId: string | null = null;

    if (chess.isCheckmate()) {
      nextStatus = 'FINISHED';
      result = 'CHECKMATE';
      winnerPlayerId = playerId;
    } else if (chess.isStalemate()) {
      nextStatus = 'FINISHED';
      result = 'STALEMATE';
    } else if (chess.isDraw()) {
      nextStatus = 'FINISHED';
      result = 'DRAW';
    }

    const moveCountResult = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM moves WHERE game_id = $1', [
      gameId,
    ]);
    const moveNumber = Number(moveCountResult.rows[0].count) + 1;

    await client.query(
      `
        INSERT INTO moves (
          id,
          move_id,
          game_id,
          player_id,
          move_number,
          from_square,
          to_square,
          promotion,
          san,
          fen_after
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        randomUUID(),
        input.moveId,
        gameId,
        playerId,
        moveNumber,
        input.from,
        input.to,
        input.promotion ?? null,
        moveResult.san,
        fenAfter,
      ],
    );

    await client.query(
      `
        UPDATE games
        SET fen = $2,
            status = $3::varchar,
            result = $4::varchar,
            winner_player_id = $5::uuid,
            finished_at = CASE WHEN $6::boolean THEN NOW() ELSE finished_at END,
            updated_at = NOW(),
            version = version + 1
        WHERE id = $1
      `,
      [gameId, fenAfter, nextStatus, result, winnerPlayerId, nextStatus === 'FINISHED'],
    );

    const game = await fetchGameById(client, gameId);

    if (!game) {
      throw new Error('Updated game could not be loaded');
    }

    await client.query('COMMIT');

    return {
      game,
      move: {
        id: input.moveId,
        san: moveResult.san,
      },
      status: 'played',
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function resignGame(gameId: string, playerId: string): Promise<ResignGameResult> {
  const client = await requirePool().connect();

  try {
    await client.query('BEGIN');

    const lockedGameResult = await client.query<LockedGameRow>(
      `
        SELECT id, white_player_id, black_player_id, status, fen
        FROM games
        WHERE id = $1
        FOR UPDATE
      `,
      [gameId],
    );

    const lockedGame = lockedGameResult.rows[0];

    if (!lockedGame) {
      await client.query('ROLLBACK');
      return { status: 'not_found' };
    }

    const winnerPlayerId =
      lockedGame.white_player_id === playerId
        ? lockedGame.black_player_id
        : lockedGame.black_player_id === playerId
          ? lockedGame.white_player_id
          : null;

    if (!winnerPlayerId) {
      await client.query('ROLLBACK');
      return { status: 'not_participant' };
    }

    if (lockedGame.status !== 'ACTIVE') {
      await client.query('ROLLBACK');
      return { status: 'not_active' };
    }

    await client.query(
      `
        UPDATE games
        SET status = 'FINISHED',
            result = 'RESIGNATION',
            winner_player_id = $2,
            finished_at = NOW(),
            updated_at = NOW(),
            version = version + 1
        WHERE id = $1
      `,
      [gameId, winnerPlayerId],
    );

    const game = await fetchGameById(client, gameId);

    if (!game) {
      throw new Error('Resigned game could not be loaded');
    }

    await client.query('COMMIT');
    return { game, status: 'resigned' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
