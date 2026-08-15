import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { WebSocket } from 'ws';

import { createApp } from '../app.js';
import { closeDatabasePool, pool } from '../db/pool.js';
import { attachWebSocketServer } from '../ws/websocketServer.js';

const createdPlayerIds: string[] = [];
const createdGameIds: string[] = [];

type RequestOptions = {
  body?: string;
  headers?: Record<string, string>;
  method?: string;
};

type SmokeSocket = {
  close: () => void;
  send: (message: unknown) => void;
  waitFor: (type: string, predicate?: (message: Record<string, unknown>) => boolean) => Promise<Record<string, unknown>>;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function request(baseUrl: string, path: string, options: RequestOptions = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });

  return {
    body: await response.json(),
    status: response.status,
  };
}

async function createAnonymousPlayer(baseUrl: string) {
  const result = await request(baseUrl, '/api/players/anonymous', { method: 'POST' });

  assert(result.status === 201, `anonymous player expected 201, got ${result.status}`);
  assert(result.body.player?.id, 'anonymous player response should include player.id');
  assert(result.body.token, 'anonymous player response should include token');

  createdPlayerIds.push(result.body.player.id);

  return result.body as {
    player: {
      id: string;
      nickname: string;
    };
    token: string;
  };
}

async function openSmokeSocket(wsUrl: string): Promise<SmokeSocket> {
  const socket = new WebSocket(wsUrl);
  const messages: Array<Record<string, unknown>> = [];
  const waiters: Array<{
    predicate: (message: Record<string, unknown>) => boolean;
    reject: (error: Error) => void;
    resolve: (message: Record<string, unknown>) => void;
    timeout: NodeJS.Timeout;
  }> = [];

  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });

  socket.on('message', (rawMessage) => {
    const message = JSON.parse(rawMessage.toString()) as Record<string, unknown>;
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
    close: () => {
      socket.close();
    },
    send: (message: unknown) => {
      socket.send(JSON.stringify(message));
    },
    waitFor: (type: string, predicate = () => true) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const messageIndex = messages.findIndex(
          (message) => message.type === type && predicate(message),
        );

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

async function cleanup() {
  if (!pool) {
    return;
  }

  if (createdGameIds.length > 0) {
    await pool.query('DELETE FROM games WHERE id = ANY($1::uuid[])', [createdGameIds]);
  }

  if (createdPlayerIds.length > 0) {
    await pool.query('DELETE FROM players WHERE id = ANY($1::uuid[])', [createdPlayerIds]);
  }
}

async function runSmokeTest(baseUrl: string) {
  const health = await request(baseUrl, '/health');
  assert(health.status === 200, `health expected 200, got ${health.status}`);
  assert(health.body.database === 'ok', `database expected ok, got ${health.body.database}`);

  const white = await createAnonymousPlayer(baseUrl);
  const black = await createAnonymousPlayer(baseUrl);
  const third = await createAnonymousPlayer(baseUrl);

  const invalidJoin = await request(baseUrl, '/api/games/join', {
    body: JSON.stringify({ joinCode: 'OOO11' }),
    headers: { authorization: `Bearer ${black.token}` },
    method: 'POST',
  });
  assert(invalidJoin.status === 400, `invalid join expected 400, got ${invalidJoin.status}`);
  assert(invalidJoin.body.error?.code === 'INVALID_JOIN_CODE', 'invalid join should return INVALID_JOIN_CODE');

  const createdGame = await request(baseUrl, '/api/games', {
    headers: { authorization: `Bearer ${white.token}` },
    method: 'POST',
  });
  assert(createdGame.status === 201, `create game expected 201, got ${createdGame.status}`);
  assert(createdGame.body.game?.status === 'WAITING', 'created game should be WAITING');
  assert(createdGame.body.game?.color === 'white', 'creator should be white');
  assert(
    /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(createdGame.body.game?.joinCode),
    'join code should be six safe characters',
  );

  createdGameIds.push(createdGame.body.game.id);

  const waitingState = await request(baseUrl, `/api/games/${createdGame.body.game.id}`, {
    headers: { authorization: `Bearer ${white.token}` },
  });
  assert(waitingState.status === 200, `get waiting game expected 200, got ${waitingState.status}`);
  assert(waitingState.body.game?.black === null, 'waiting game should have no black player');
  assert(waitingState.body.game?.turn === 'white', 'initial turn should be white');

  const joinedGame = await request(baseUrl, '/api/games/join', {
    body: JSON.stringify({ joinCode: createdGame.body.game.joinCode.toLowerCase() }),
    headers: { authorization: `Bearer ${black.token}` },
    method: 'POST',
  });
  assert(joinedGame.status === 200, `join game expected 200, got ${joinedGame.status}`);
  assert(joinedGame.body.game?.status === 'ACTIVE', 'joined game should be ACTIVE');
  assert(joinedGame.body.game?.color === 'black', 'joining player should be black');

  const activeState = await request(baseUrl, `/api/games/${createdGame.body.game.id}`, {
    headers: { authorization: `Bearer ${black.token}` },
  });
  assert(activeState.status === 200, `get active game expected 200, got ${activeState.status}`);
  assert(activeState.body.game?.white?.id === white.player.id, 'active game should include white player');
  assert(activeState.body.game?.black?.id === black.player.id, 'active game should include black player');
  assert(activeState.body.game?.status === 'ACTIVE', 'active game state should be ACTIVE');

  const blackWrongTurn = await request(baseUrl, `/api/games/${createdGame.body.game.id}/moves`, {
    body: JSON.stringify({ from: 'e7', moveId: randomUUID(), to: 'e5' }),
    headers: { authorization: `Bearer ${black.token}` },
    method: 'POST',
  });
  assert(blackWrongTurn.status === 409, `wrong turn expected 409, got ${blackWrongTurn.status}`);
  assert(blackWrongTurn.body.error?.code === 'NOT_YOUR_TURN', 'wrong turn should return NOT_YOUR_TURN');

  const invalidMove = await request(baseUrl, `/api/games/${createdGame.body.game.id}/moves`, {
    body: JSON.stringify({ from: 'e2', moveId: randomUUID(), to: 'e5' }),
    headers: { authorization: `Bearer ${white.token}` },
    method: 'POST',
  });
  assert(invalidMove.status === 400, `invalid move expected 400, got ${invalidMove.status}`);
  assert(invalidMove.body.error?.code === 'INVALID_MOVE', 'invalid move should return INVALID_MOVE');

  const whiteMoveId = randomUUID();
  const whiteMove = await request(baseUrl, `/api/games/${createdGame.body.game.id}/moves`, {
    body: JSON.stringify({ from: 'e2', moveId: whiteMoveId, to: 'e4' }),
    headers: { authorization: `Bearer ${white.token}` },
    method: 'POST',
  });
  assert(whiteMove.status === 201, `white move expected 201, got ${whiteMove.status}`);
  assert(whiteMove.body.move?.san === 'e4', 'white move should return SAN e4');
  assert(whiteMove.body.game?.turn === 'black', 'turn should be black after e4');
  assert(whiteMove.body.game?.version === activeState.body.game.version + 1, 'version should increment after e4');

  const duplicateWhiteMove = await request(baseUrl, `/api/games/${createdGame.body.game.id}/moves`, {
    body: JSON.stringify({ from: 'e2', moveId: whiteMoveId, to: 'e4' }),
    headers: { authorization: `Bearer ${white.token}` },
    method: 'POST',
  });
  assert(duplicateWhiteMove.status === 200, `duplicate move expected 200, got ${duplicateWhiteMove.status}`);
  assert(duplicateWhiteMove.body.duplicate === true, 'duplicate move should be reported as duplicate');
  assert(duplicateWhiteMove.body.game?.version === whiteMove.body.game.version, 'duplicate move should not increment version');

  const blackMove = await request(baseUrl, `/api/games/${createdGame.body.game.id}/moves`, {
    body: JSON.stringify({ from: 'e7', moveId: randomUUID(), to: 'e5' }),
    headers: { authorization: `Bearer ${black.token}` },
    method: 'POST',
  });
  assert(blackMove.status === 201, `black move expected 201, got ${blackMove.status}`);
  assert(blackMove.body.move?.san === 'e5', 'black move should return SAN e5');
  assert(blackMove.body.game?.turn === 'white', 'turn should be white after e5');

  const wsBaseUrl = baseUrl.replace('http://', 'ws://').replace('https://', 'wss://');
  const whiteSocket = await openSmokeSocket(`${wsBaseUrl}/ws?token=${encodeURIComponent(white.token)}`);
  const blackSocket = await openSmokeSocket(`${wsBaseUrl}/ws?token=${encodeURIComponent(black.token)}`);

  try {
    whiteSocket.send({ type: 'PING' });
    const pong = await whiteSocket.waitFor('PONG');
    assert(pong.type === 'PONG', 'white socket should receive PONG');

    whiteSocket.send({ gameId: createdGame.body.game.id, type: 'JOIN_GAME' });
    const whiteWsState = await whiteSocket.waitFor('GAME_STATE');
    assert(
      (whiteWsState.game as { color?: string; turn?: string })?.color === 'white',
      'white socket should receive white game state',
    );

    blackSocket.send({ gameId: createdGame.body.game.id, type: 'JOIN_GAME' });
    const blackWsState = await blackSocket.waitFor('GAME_STATE');
    assert(
      (blackWsState.game as { color?: string; turn?: string })?.color === 'black',
      'black socket should receive black game state',
    );

    const wsMoveId = randomUUID();
    whiteSocket.send({
      from: 'g1',
      gameId: createdGame.body.game.id,
      moveId: wsMoveId,
      to: 'f3',
      type: 'MOVE',
    });

    const acceptedMove = await whiteSocket.waitFor('MOVE_ACCEPTED', (message) => message.moveId === wsMoveId);
    assert(acceptedMove.san === 'Nf3', 'WebSocket move should return SAN Nf3');
    assert(acceptedMove.turn === 'black', 'WebSocket accepted move should switch turn to black');

    const broadcastState = await blackSocket.waitFor('GAME_STATE', (message) => {
      const game = message.game as { turn?: string; version?: number };
      return game.turn === 'black' && game.version === blackMove.body.game.version + 1;
    });
    assert(
      (broadcastState.game as { turn?: string })?.turn === 'black',
      'black socket should receive broadcast state after Nf3',
    );

    const resignedGame = await request(baseUrl, `/api/games/${createdGame.body.game.id}/resign`, {
      headers: { authorization: `Bearer ${black.token}` },
      method: 'POST',
    });
    assert(resignedGame.status === 200, `resign expected 200, got ${resignedGame.status}`);
    assert(resignedGame.body.game?.status === 'FINISHED', 'resigned game should be FINISHED');
    assert(resignedGame.body.game?.result === 'RESIGNATION', 'resigned game result should be RESIGNATION');
    assert(resignedGame.body.game?.winnerPlayerId === white.player.id, 'white should win when black resigns');

    const finishedMessage = await whiteSocket.waitFor('GAME_FINISHED', (message) => message.gameId === createdGame.body.game.id);
    assert(finishedMessage.winnerPlayerId === white.player.id, 'GAME_FINISHED should include white winner');

    const finishedState = await blackSocket.waitFor('GAME_STATE', (message) => {
      const game = message.game as { status?: string; winnerPlayerId?: string };
      return game.status === 'FINISHED' && game.winnerPlayerId === white.player.id;
    });
    assert(
      (finishedState.game as { result?: string })?.result === 'RESIGNATION',
      'black socket should receive finished game state',
    );

    const moveAfterResignId = randomUUID();
    whiteSocket.send({
      from: 'f1',
      gameId: createdGame.body.game.id,
      moveId: moveAfterResignId,
      to: 'c4',
      type: 'MOVE',
    });
    const rejectedMove = await whiteSocket.waitFor('MOVE_REJECTED', (message) => message.moveId === moveAfterResignId);
    assert(rejectedMove.reason === 'GAME_FINISHED', 'move after resignation should be rejected as GAME_FINISHED');
  } finally {
    whiteSocket.close();
    blackSocket.close();
  }

  const thirdJoin = await request(baseUrl, '/api/games/join', {
    body: JSON.stringify({ joinCode: createdGame.body.game.joinCode }),
    headers: { authorization: `Bearer ${third.token}` },
    method: 'POST',
  });
  assert(thirdJoin.status === 409, `third join expected 409, got ${thirdJoin.status}`);
  assert(thirdJoin.body.error?.code === 'GAME_NOT_WAITING', 'third join should return GAME_NOT_WAITING');

  console.log(
    JSON.stringify(
      {
        activeStatus: activeState.body.game.status,
        createdColor: createdGame.body.game.color,
        database: health.body.database,
        invalidJoinCode: invalidJoin.body.error.code,
        invalidMoveCode: invalidMove.body.error.code,
        joinColor: joinedGame.body.game.color,
        moves: [whiteMove.body.move.san, blackMove.body.move.san, 'Nf3'],
        resignation: 'ok',
        thirdJoinCode: thirdJoin.body.error.code,
        wrongTurnCode: blackWrongTurn.body.error.code,
        ws: 'ok',
      },
      null,
      2,
    ),
  );
}

const app = createApp();
const server = createServer(app);
const webSocketServer = attachWebSocketServer(server);

server.listen(0, '127.0.0.1', async () => {
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Unexpected server address');
  }

  try {
    await runSmokeTest(`http://127.0.0.1:${address.port}`);
  } finally {
    await cleanup();
    webSocketServer.close();
    server.close(() => {
      closeDatabasePool().catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
    });
  }
});
