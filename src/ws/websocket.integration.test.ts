import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { WebSocket, type WebSocketServer } from 'ws';

import { createApp } from '../app.js';
import { env } from '../config/env.js';
import { closeDatabasePool, pool } from '../db/pool.js';
import { attachWebSocketServer } from './websocketServer.js';

type JsonObject = Record<string, unknown>;

type TestPlayer = {
  player: {
    id: string;
    nickname: string;
  };
  token: string;
};

type TestSocket = {
  close: () => Promise<void>;
  send: (message: unknown) => void;
  waitFor: (type: string, predicate?: (message: JsonObject) => boolean) => Promise<JsonObject>;
};

const shouldRunIntegrationTests = Boolean(env.databaseUrl && env.jwtSecret);
const createdGameIds: string[] = [];
const createdPlayerIds: string[] = [];
let baseUrl = '';
let server: Server | null = null;
let webSocketServer: WebSocketServer | null = null;

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

async function request(
  path: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
    method?: string;
  } = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
    method: options.method ?? 'GET',
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  return {
    body: (await response.json()) as JsonObject,
    status: response.status,
  };
}

async function createAnonymousPlayer() {
  const response = await request('/api/players/anonymous', {
    method: 'POST',
  });

  assert.equal(response.status, 201);

  const player = asObject(response.body.player);
  const createdPlayer = {
    player: {
      id: String(player.id),
      nickname: String(player.nickname),
    },
    token: String(response.body.token),
  } satisfies TestPlayer;

  createdPlayerIds.push(createdPlayer.player.id);

  return createdPlayer;
}

async function createActiveGame(white: TestPlayer, black: TestPlayer) {
  const createdGame = await request('/api/games', {
    headers: authHeader(white.token),
    method: 'POST',
  });

  assert.equal(createdGame.status, 201);

  const game = asObject(createdGame.body.game);
  const gameId = String(game.id);
  const joinCode = String(game.joinCode);
  createdGameIds.push(gameId);

  const joinedGame = await request('/api/games/join', {
    body: { joinCode },
    headers: authHeader(black.token),
    method: 'POST',
  });

  assert.equal(joinedGame.status, 200);

  return gameId;
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

async function openTestSocket(token: string): Promise<TestSocket> {
  const socket = new WebSocket(`${baseUrl.replace('http://', 'ws://')}/ws?token=${encodeURIComponent(token)}`);
  const messages: JsonObject[] = [];
  const waiters: Array<{
    predicate: (message: JsonObject) => boolean;
    reject: (error: Error) => void;
    resolve: (message: JsonObject) => void;
    timeout: NodeJS.Timeout;
  }> = [];

  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  socket.on('message', (rawMessage) => {
    const message = JSON.parse(rawMessage.toString()) as JsonObject;
    const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(message));

    if (waiterIndex >= 0) {
      const [waiter] = waiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timeout);
      waiter.resolve(message);
      return;
    }

    messages.push(message);
  });

  return {
    close: () =>
      new Promise<void>((resolve) => {
        if (socket.readyState === WebSocket.CLOSED) {
          resolve();
          return;
        }

        socket.once('close', () => resolve());
        socket.close();
      }),
    send: (message: unknown) => socket.send(JSON.stringify(message)),
    waitFor: (type: string, predicate = () => true) =>
      new Promise<JsonObject>((resolve, reject) => {
        const messageIndex = messages.findIndex((message) => message.type === type && predicate(message));

        if (messageIndex >= 0) {
          const [message] = messages.splice(messageIndex, 1);
          resolve(message);
          return;
        }

        const timeout = setTimeout(() => {
          const waiterIndex = waiters.findIndex((waiter) => waiter.resolve === resolve);

          if (waiterIndex >= 0) {
            waiters.splice(waiterIndex, 1);
          }

          reject(new Error(`Timed out waiting for WebSocket message ${type}`));
        }, 3000);

        waiters.push({
          predicate: (message) => message.type === type && predicate(message),
          reject,
          resolve,
          timeout,
        });
      }),
  };
}

before(async () => {
  if (!shouldRunIntegrationTests) {
    return;
  }

  const app = createApp();
  server = createServer(app);
  webSocketServer = attachWebSocketServer(server);

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

  if (webSocketServer) {
    webSocketServer.close();
  }

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
  'WebSocket rejects invalid authentication tokens',
  { skip: shouldRunIntegrationTests ? false : 'DATABASE_URL and JWT_SECRET are required' },
  async () => {
    const socket = new WebSocket(`${baseUrl.replace('http://', 'ws://')}/ws?token=invalid-token`);

    const closeEvent = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
      socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
      socket.once('error', reject);
    });

    assert.equal(closeEvent.code, 1008);
    assert.equal(closeEvent.reason, 'Unauthorized');
  },
);

test(
  'WebSocket multiplayer flow broadcasts authoritative state',
  { skip: shouldRunIntegrationTests ? false : 'DATABASE_URL and JWT_SECRET are required' },
  async () => {
    const white = await createAnonymousPlayer();
    const black = await createAnonymousPlayer();
    const gameId = await createActiveGame(white, black);
    const whiteSocket = await openTestSocket(white.token);
    let blackSocket = await openTestSocket(black.token);

    try {
      whiteSocket.send({ type: 'PING' });
      assert.equal((await whiteSocket.waitFor('PONG')).type, 'PONG');

      whiteSocket.send({ gameId, type: 'JOIN_GAME' });
      const whiteInitialState = await whiteSocket.waitFor('GAME_STATE');
      assert.equal(asObject(whiteInitialState.game).color, 'white');
      assert.equal(asObject(whiteInitialState.game).turn, 'white');

      blackSocket.send({ gameId, type: 'JOIN_GAME' });
      await whiteSocket.waitFor('PLAYER_JOINED', (message) => message.playerId === black.player.id);
      const blackInitialState = await blackSocket.waitFor('GAME_STATE');
      assert.equal(asObject(blackInitialState.game).color, 'black');

      await blackSocket.close();
      const disconnectedBlack = await whiteSocket.waitFor(
        'PLAYER_DISCONNECTED',
        (message) => message.playerId === black.player.id,
      );
      assert.equal(disconnectedBlack.gameId, gameId);

      blackSocket = await openTestSocket(black.token);
      blackSocket.send({ gameId, type: 'JOIN_GAME' });
      const reconnectedBlack = await whiteSocket.waitFor(
        'PLAYER_RECONNECTED',
        (message) => message.playerId === black.player.id,
      );
      assert.equal(reconnectedBlack.gameId, gameId);

      const wrongTurnMoveId = randomUUID();
      blackSocket.send({
        from: 'e7',
        gameId,
        moveId: wrongTurnMoveId,
        to: 'e5',
        type: 'MOVE',
      });
      const wrongTurn = await blackSocket.waitFor('MOVE_REJECTED', (message) => message.moveId === wrongTurnMoveId);
      assert.equal(wrongTurn.reason, 'NOT_YOUR_TURN');

      const whiteMoveId = randomUUID();
      whiteSocket.send({
        from: 'e2',
        gameId,
        moveId: whiteMoveId,
        to: 'e4',
        type: 'MOVE',
      });
      const acceptedWhiteMove = await whiteSocket.waitFor('MOVE_ACCEPTED', (message) => message.moveId === whiteMoveId);
      assert.equal(acceptedWhiteMove.san, 'e4');
      assert.equal(acceptedWhiteMove.turn, 'black');

      const blackStateAfterWhiteMove = await blackSocket.waitFor('GAME_STATE', (message) => {
        const game = asObject(message.game);
        return game.turn === 'black' && typeof game.fen === 'string' && game.fen.includes(' b ');
      });
      assert.equal(asObject(blackStateAfterWhiteMove.game).turn, 'black');

      whiteSocket.send({
        from: 'g1',
        gameId,
        moveId: whiteMoveId,
        to: 'f3',
        type: 'MOVE',
      });
      const duplicateMove = await whiteSocket.waitFor('MOVE_ACCEPTED', (message) => message.moveId === whiteMoveId);
      assert.equal(duplicateMove.duplicate, true);

      const blackMoveId = randomUUID();
      blackSocket.send({
        from: 'e7',
        gameId,
        moveId: blackMoveId,
        to: 'e5',
        type: 'MOVE',
      });
      const acceptedBlackMove = await blackSocket.waitFor('MOVE_ACCEPTED', (message) => message.moveId === blackMoveId);
      assert.equal(acceptedBlackMove.san, 'e5');
      assert.equal(acceptedBlackMove.turn, 'white');

      const whiteStateAfterBlackMove = await whiteSocket.waitFor('GAME_STATE', (message) => {
        const game = asObject(message.game);
        return game.turn === 'white' && typeof game.fen === 'string' && game.fen.includes(' w ');
      });
      assert.equal(asObject(whiteStateAfterBlackMove.game).turn, 'white');

      blackSocket.send({ gameId, type: 'RESIGN' });

      const finishedMessage = await whiteSocket.waitFor('GAME_FINISHED', (message) => message.gameId === gameId);
      assert.equal(finishedMessage.winnerPlayerId, white.player.id);

      const blackFinishedState = await blackSocket.waitFor('GAME_STATE', (message) => {
        const game = asObject(message.game);
        return game.status === 'FINISHED' && game.winnerPlayerId === white.player.id;
      });
      assert.equal(asObject(blackFinishedState.game).result, 'RESIGNATION');

      const moveAfterFinishId = randomUUID();
      whiteSocket.send({
        from: 'g1',
        gameId,
        moveId: moveAfterFinishId,
        to: 'f3',
        type: 'MOVE',
      });
      const rejectedFinishedMove = await whiteSocket.waitFor(
        'MOVE_REJECTED',
        (message) => message.moveId === moveAfterFinishId,
      );
      assert.equal(rejectedFinishedMove.reason, 'GAME_FINISHED');
    } finally {
      await Promise.all([whiteSocket.close(), blackSocket.close()]);
    }
  },
);
