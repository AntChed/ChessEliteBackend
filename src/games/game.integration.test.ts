import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { createApp } from '../app.js';
import { env } from '../config/env.js';
import { closeDatabasePool, pool } from '../db/pool.js';

type JsonObject = Record<string, unknown>;

type TestPlayer = {
  player: {
    id: string;
    nickname: string;
  };
  token: string;
};

type TestResponse<TBody extends JsonObject = JsonObject> = {
  body: TBody;
  status: number;
};

const shouldRunIntegrationTests = Boolean(env.databaseUrl && env.jwtSecret);
const createdGameIds: string[] = [];
const createdPlayerIds: string[] = [];
let baseUrl = '';
let server: Server | null = null;

function asObject(value: unknown): JsonObject {
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);

  return value as JsonObject;
}

function authHeader(token: string) {
  return {
    authorization: `Bearer ${token}`,
  };
}

async function request<TBody extends JsonObject = JsonObject>(
  path: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
    method?: string;
  } = {},
): Promise<TestResponse<TBody>> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
    method: options.method ?? 'GET',
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  return {
    body: (await response.json()) as TBody,
    status: response.status,
  };
}

async function createAnonymousPlayer() {
  const response = await request<TestPlayer>('/api/players/anonymous', {
    method: 'POST',
  });

  assert.equal(response.status, 201);
  assert.match(response.body.player.id, /^[0-9a-f-]{36}$/);
  assert.equal(typeof response.body.token, 'string');
  createdPlayerIds.push(response.body.player.id);

  return response.body;
}

async function createActiveGame() {
  const white = await createAnonymousPlayer();
  const black = await createAnonymousPlayer();

  const createdGame = await request('/api/games', {
    headers: authHeader(white.token),
    method: 'POST',
  });
  assert.equal(createdGame.status, 201);

  const createdGameBody = asObject(createdGame.body.game);
  const gameId = String(createdGameBody.id);
  const joinCode = String(createdGameBody.joinCode);
  createdGameIds.push(gameId);

  const joinedGame = await request('/api/games/join', {
    body: { joinCode },
    headers: authHeader(black.token),
    method: 'POST',
  });
  assert.equal(joinedGame.status, 200);

  return {
    black,
    gameId,
    white,
  };
}

async function forceGameFen(gameId: string, fen: string) {
  assert.notEqual(pool, null);

  await pool!.query(
    `
      UPDATE games
      SET fen = $2,
          status = 'ACTIVE',
          result = NULL,
          winner_player_id = NULL,
          finished_at = NULL,
          updated_at = NOW(),
          version = version + 1
      WHERE id = $1
    `,
    [gameId, fen],
  );
}

async function playTestMove({
  from,
  gameId,
  promotion,
  token,
  to,
}: {
  from: string;
  gameId: string;
  promotion?: string;
  token: string;
  to: string;
}) {
  return request(`/api/games/${gameId}/moves`, {
    body: { from, moveId: randomUUID(), promotion, to },
    headers: authHeader(token),
    method: 'POST',
  });
}

async function cleanupCreatedRows() {
  if (!pool) {
    return;
  }

  if (createdGameIds.length > 0) {
    await pool.query('DELETE FROM games WHERE id = ANY($1::uuid[])', [createdGameIds]);
    createdGameIds.length = 0;
  }

  if (createdPlayerIds.length > 0) {
    await pool.query('DELETE FROM players WHERE id = ANY($1::uuid[])', [createdPlayerIds]);
    createdPlayerIds.length = 0;
  }
}

before(async () => {
  if (!shouldRunIntegrationTests) {
    return;
  }

  const app = createApp();
  server = createServer(app);

  await new Promise<void>((resolve) => {
    server!.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();

  assert.notEqual(address, null);
  assert.notEqual(typeof address, 'string');

  baseUrl = `http://127.0.0.1:${(address as { port: number }).port}`;
});

after(async () => {
  await cleanupCreatedRows();

  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  await closeDatabasePool();
});

test(
  'REST multiplayer flow is server-authoritative',
  { skip: shouldRunIntegrationTests ? false : 'DATABASE_URL and JWT_SECRET are required' },
  async () => {
    const health = await request('/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.database, 'ok');

    const white = await createAnonymousPlayer();
    const black = await createAnonymousPlayer();
    const third = await createAnonymousPlayer();

    const nicknameUpdate = await request('/api/players/me', {
      body: { nickname: '  EvaMobile  ' },
      headers: authHeader(white.token),
      method: 'PATCH',
    });
    assert.equal(nicknameUpdate.status, 200);
    assert.equal(asObject(nicknameUpdate.body.player).nickname, 'EvaMobile');

    const invalidNickname = await request('/api/players/me', {
      body: { nickname: 'ab' },
      headers: authHeader(white.token),
      method: 'PATCH',
    });
    assert.equal(invalidNickname.status, 400);
    assert.equal(asObject(invalidNickname.body.error).code, 'INVALID_NICKNAME');

    const invalidJoin = await request('/api/games/join', {
      body: { joinCode: 'OOO111' },
      headers: authHeader(black.token),
      method: 'POST',
    });
    assert.equal(invalidJoin.status, 400);
    assert.equal(asObject(invalidJoin.body.error).code, 'INVALID_JOIN_CODE');

    const createdGame = await request('/api/games', {
      body: { chessSkinId: 'obsidian' },
      headers: authHeader(white.token),
      method: 'POST',
    });
    assert.equal(createdGame.status, 201);

    const createdGameBody = asObject(createdGame.body.game);
    const gameId = String(createdGameBody.id);
    const joinCode = String(createdGameBody.joinCode);
    createdGameIds.push(gameId);

    assert.equal(createdGameBody.status, 'WAITING');
    assert.equal(createdGameBody.color, 'white');
    assert.equal(createdGameBody.whitePieceSkinId, 'obsidian');
    assert.match(joinCode, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);

    const forbiddenGame = await request(`/api/games/${gameId}`, {
      headers: authHeader(third.token),
    });
    assert.equal(forbiddenGame.status, 403);
    assert.equal(asObject(forbiddenGame.body.error).code, 'FORBIDDEN');

    const joinedGame = await request('/api/games/join', {
      body: { chessSkinId: 'ivoryRoyal', joinCode: joinCode.toLowerCase() },
      headers: authHeader(black.token),
      method: 'POST',
    });
    assert.equal(joinedGame.status, 200);
    assert.equal(asObject(joinedGame.body.game).status, 'ACTIVE');
    assert.equal(asObject(joinedGame.body.game).color, 'black');
    assert.equal(asObject(joinedGame.body.game).blackPieceSkinId, 'ivoryRoyal');

    const activeGame = await request(`/api/games/${gameId}`, {
      headers: authHeader(white.token),
    });
    assert.equal(activeGame.status, 200);

    const activeGameBody = asObject(activeGame.body.game);
    assert.equal(activeGameBody.status, 'ACTIVE');
    assert.equal(activeGameBody.turn, 'white');
    assert.equal(asObject(activeGameBody.white).nickname, 'EvaMobile');
    assert.equal(asObject(activeGameBody.black).id, black.player.id);
    assert.equal(activeGameBody.whitePieceSkinId, 'obsidian');
    assert.equal(activeGameBody.blackPieceSkinId, 'ivoryRoyal');

    const thirdJoin = await request('/api/games/join', {
      body: { joinCode },
      headers: authHeader(third.token),
      method: 'POST',
    });
    assert.equal(thirdJoin.status, 409);
    assert.equal(asObject(thirdJoin.body.error).code, 'GAME_NOT_WAITING');

    const wrongTurn = await request(`/api/games/${gameId}/moves`, {
      body: { from: 'e7', moveId: randomUUID(), to: 'e5' },
      headers: authHeader(black.token),
      method: 'POST',
    });
    assert.equal(wrongTurn.status, 409);
    assert.equal(asObject(wrongTurn.body.error).code, 'NOT_YOUR_TURN');

    const invalidMove = await request(`/api/games/${gameId}/moves`, {
      body: { from: 'e2', moveId: randomUUID(), to: 'e5' },
      headers: authHeader(white.token),
      method: 'POST',
    });
    assert.equal(invalidMove.status, 400);
    assert.equal(asObject(invalidMove.body.error).code, 'INVALID_MOVE');

    const whiteMoveId = randomUUID();
    const whiteMove = await request(`/api/games/${gameId}/moves`, {
      body: { from: 'e2', moveId: whiteMoveId, to: 'e4' },
      headers: authHeader(white.token),
      method: 'POST',
    });
    assert.equal(whiteMove.status, 201);
    assert.equal(asObject(whiteMove.body.move).san, 'e4');
    assert.equal(asObject(whiteMove.body.game).turn, 'black');

    const duplicateWhiteMove = await request(`/api/games/${gameId}/moves`, {
      body: { from: 'e2', moveId: whiteMoveId, to: 'e4' },
      headers: authHeader(white.token),
      method: 'POST',
    });
    assert.equal(duplicateWhiteMove.status, 200);
    assert.equal(duplicateWhiteMove.body.duplicate, true);
    assert.equal(asObject(duplicateWhiteMove.body.game).version, asObject(whiteMove.body.game).version);

    const reusedMoveIdByBlack = await request(`/api/games/${gameId}/moves`, {
      body: { from: 'e7', moveId: whiteMoveId, to: 'e5' },
      headers: authHeader(black.token),
      method: 'POST',
    });
    assert.equal(reusedMoveIdByBlack.status, 409);
    assert.equal(asObject(reusedMoveIdByBlack.body.error).code, 'DUPLICATE_MOVE_ID');

    const blackMove = await request(`/api/games/${gameId}/moves`, {
      body: { from: 'e7', moveId: randomUUID(), to: 'e5' },
      headers: authHeader(black.token),
      method: 'POST',
    });
    assert.equal(blackMove.status, 201);
    assert.equal(asObject(blackMove.body.move).san, 'e5');
    assert.equal(asObject(blackMove.body.game).turn, 'white');

    const resignedGame = await request(`/api/games/${gameId}/resign`, {
      headers: authHeader(black.token),
      method: 'POST',
    });
    assert.equal(resignedGame.status, 200);
    assert.equal(asObject(resignedGame.body.game).status, 'FINISHED');
    assert.equal(asObject(resignedGame.body.game).result, 'RESIGNATION');
    assert.equal(asObject(resignedGame.body.game).winnerPlayerId, white.player.id);

    const moveAfterResign = await request(`/api/games/${gameId}/moves`, {
      body: { from: 'g1', moveId: randomUUID(), to: 'f3' },
      headers: authHeader(white.token),
      method: 'POST',
    });
    assert.equal(moveAfterResign.status, 409);
    assert.equal(asObject(moveAfterResign.body.error).code, 'GAME_NOT_ACTIVE');
  },
);

test(
  'REST stores checkmate as the final online result',
  { skip: shouldRunIntegrationTests ? false : 'DATABASE_URL and JWT_SECRET are required' },
  async () => {
    const white = await createAnonymousPlayer();
    const black = await createAnonymousPlayer();

    const createdGame = await request('/api/games', {
      headers: authHeader(white.token),
      method: 'POST',
    });
    assert.equal(createdGame.status, 201);

    const createdGameBody = asObject(createdGame.body.game);
    const gameId = String(createdGameBody.id);
    const joinCode = String(createdGameBody.joinCode);
    createdGameIds.push(gameId);

    const joinedGame = await request('/api/games/join', {
      body: { joinCode },
      headers: authHeader(black.token),
      method: 'POST',
    });
    assert.equal(joinedGame.status, 200);

    const moves = [
      { from: 'f2', token: white.token, to: 'f3' },
      { from: 'e7', token: black.token, to: 'e5' },
      { from: 'g2', token: white.token, to: 'g4' },
      { from: 'd8', token: black.token, to: 'h4' },
    ];
    let finalMove: TestResponse | null = null;

    for (const move of moves) {
      finalMove = await request(`/api/games/${gameId}/moves`, {
        body: { from: move.from, moveId: randomUUID(), to: move.to },
        headers: authHeader(move.token),
        method: 'POST',
      });
      assert.equal(finalMove.status, 201);
    }

    assert.notEqual(finalMove, null);
    const finalGame = asObject(finalMove!.body.game);
    assert.equal(finalGame.status, 'FINISHED');
    assert.equal(finalGame.result, 'CHECKMATE');
    assert.equal(finalGame.winnerPlayerId, black.player.id);
  },
);

test(
  'REST accepts promotion, en passant, and castling as authoritative legal moves',
  { skip: shouldRunIntegrationTests ? false : 'DATABASE_URL and JWT_SECRET are required' },
  async () => {
    const promotionGame = await createActiveGame();
    await forceGameFen(promotionGame.gameId, '7k/P7/8/8/8/8/8/4K3 w - - 0 1');

    const promotionMove = await playTestMove({
      from: 'a7',
      gameId: promotionGame.gameId,
      promotion: 'q',
      to: 'a8',
      token: promotionGame.white.token,
    });
    assert.equal(promotionMove.status, 201);
    assert.equal(asObject(promotionMove.body.move).san, 'a8=Q+');
    assert.match(String(asObject(promotionMove.body.game).fen), /^Q6k\//);
    assert.equal(asObject(promotionMove.body.game).status, 'ACTIVE');

    const enPassantGame = await createActiveGame();
    await forceGameFen(enPassantGame.gameId, '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');

    const enPassantMove = await playTestMove({
      from: 'e5',
      gameId: enPassantGame.gameId,
      to: 'd6',
      token: enPassantGame.white.token,
    });
    assert.equal(enPassantMove.status, 201);
    assert.equal(asObject(enPassantMove.body.move).san, 'exd6');
    assert.match(String(asObject(enPassantMove.body.game).fen), /^4k3\/8\/3P4\/8\//);
    assert.equal(asObject(enPassantMove.body.game).status, 'ACTIVE');

    const castlingGame = await createActiveGame();
    await forceGameFen(castlingGame.gameId, 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');

    const castlingMove = await playTestMove({
      from: 'e1',
      gameId: castlingGame.gameId,
      to: 'g1',
      token: castlingGame.white.token,
    });
    assert.equal(castlingMove.status, 201);
    assert.equal(asObject(castlingMove.body.move).san, 'O-O');
    assert.match(String(asObject(castlingMove.body.game).fen), /^r3k2r\/8\/8\/8\/8\/8\/8\/R4RK1 b kq/);
    assert.equal(asObject(castlingMove.body.game).status, 'ACTIVE');
  },
);

test(
  'REST stores stalemate and draw as final online results',
  { skip: shouldRunIntegrationTests ? false : 'DATABASE_URL and JWT_SECRET are required' },
  async () => {
    const stalemateGame = await createActiveGame();
    await forceGameFen(stalemateGame.gameId, '7k/5K2/8/6Q1/8/8/8/8 w - - 0 1');

    const stalemateMove = await playTestMove({
      from: 'g5',
      gameId: stalemateGame.gameId,
      to: 'g6',
      token: stalemateGame.white.token,
    });
    assert.equal(stalemateMove.status, 201);
    assert.equal(asObject(stalemateMove.body.move).san, 'Qg6');
    assert.equal(asObject(stalemateMove.body.game).status, 'FINISHED');
    assert.equal(asObject(stalemateMove.body.game).result, 'STALEMATE');
    assert.equal(asObject(stalemateMove.body.game).winnerPlayerId, null);

    const drawGame = await createActiveGame();
    await forceGameFen(drawGame.gameId, '7k/8/8/8/8/8/8/4K2R w - - 99 150');

    const drawMove = await playTestMove({
      from: 'h1',
      gameId: drawGame.gameId,
      to: 'h2',
      token: drawGame.white.token,
    });
    assert.equal(drawMove.status, 201);
    assert.equal(asObject(drawMove.body.move).san, 'Rh2+');
    assert.equal(asObject(drawMove.body.game).status, 'FINISHED');
    assert.equal(asObject(drawMove.body.game).result, 'DRAW');
    assert.equal(asObject(drawMove.body.game).winnerPlayerId, null);
  },
);
