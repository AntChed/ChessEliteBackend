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
    assert.match(joinCode, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);

    const forbiddenGame = await request(`/api/games/${gameId}`, {
      headers: authHeader(third.token),
    });
    assert.equal(forbiddenGame.status, 403);
    assert.equal(asObject(forbiddenGame.body.error).code, 'FORBIDDEN');

    const joinedGame = await request('/api/games/join', {
      body: { joinCode: joinCode.toLowerCase() },
      headers: authHeader(black.token),
      method: 'POST',
    });
    assert.equal(joinedGame.status, 200);
    assert.equal(asObject(joinedGame.body.game).status, 'ACTIVE');
    assert.equal(asObject(joinedGame.body.game).color, 'black');

    const activeGame = await request(`/api/games/${gameId}`, {
      headers: authHeader(white.token),
    });
    assert.equal(activeGame.status, 200);

    const activeGameBody = asObject(activeGame.body.game);
    assert.equal(activeGameBody.status, 'ACTIVE');
    assert.equal(activeGameBody.turn, 'white');
    assert.equal(asObject(activeGameBody.white).nickname, 'EvaMobile');
    assert.equal(asObject(activeGameBody.black).id, black.player.id);

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
