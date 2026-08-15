import type { IncomingMessage, Server } from 'node:http';

import { WebSocket, WebSocketServer } from 'ws';

import { verifyPlayerToken } from '../auth/tokens.js';
import { publishGameFinished, publishGameStateUpdated, subscribeGameEvents } from '../games/gameEvents.js';
import { findGameById, playMove, resignGame } from '../games/game.repository.js';
import { getPlayerColor, presentGameState } from '../games/game.presenter.js';
import type { Game } from '../games/game.types.js';
import { findPlayerById, touchPlayerLastSeen } from '../players/player.repository.js';
import type { Player } from '../players/player.types.js';
import type { ClientMessage, MoveRejectedReason, ServerMessage } from './messages.js';
import { serializeServerMessage } from './messages.js';

type AuthenticatedSocket = WebSocket & {
  joinedGameIds?: Set<string>;
  player?: Player;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const squarePattern = /^[a-h][1-8]$/;
const promotions = new Set(['b', 'n', 'q', 'r']);

type Promotion = 'b' | 'n' | 'q' | 'r';

function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(serializeServerMessage(message));
  }
}

function readToken(request: IncomingMessage) {
  const url = new URL(request.url ?? '/ws', 'http://localhost');
  return url.searchParams.get('token');
}

async function authenticateSocket(request: IncomingMessage) {
  const token = readToken(request);

  if (!token) {
    return null;
  }

  try {
    const payload = verifyPlayerToken(token);
    const player = await findPlayerById(payload.playerId);

    if (!player || player.tokenVersion !== payload.tokenVersion) {
      return null;
    }

    touchPlayerLastSeen(player.id).catch(() => undefined);
    return player;
  } catch {
    return null;
  }
}

function parseJson(rawMessage: Buffer | ArrayBuffer | Buffer[]) {
  try {
    return JSON.parse(rawMessage.toString()) as unknown;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function parseClientMessage(value: unknown): ClientMessage | null {
  if (!isObject(value) || typeof value.type !== 'string') {
    return null;
  }

  if (value.type === 'PING') {
    return { type: 'PING' };
  }

  if (value.type === 'JOIN_GAME' && typeof value.gameId === 'string') {
    return {
      gameId: value.gameId,
      type: 'JOIN_GAME',
    };
  }

  if (
    value.type === 'MOVE' &&
    typeof value.gameId === 'string' &&
    typeof value.moveId === 'string' &&
    typeof value.from === 'string' &&
    typeof value.to === 'string'
  ) {
    const promotion = typeof value.promotion === 'string' ? value.promotion : undefined;

    if (promotion && !promotions.has(promotion)) {
      return null;
    }

    return {
      from: value.from,
      gameId: value.gameId,
      moveId: value.moveId,
      promotion: promotion as Promotion | undefined,
      to: value.to,
      type: 'MOVE',
    };
  }

  if (value.type === 'RESIGN' && typeof value.gameId === 'string') {
    return {
      gameId: value.gameId,
      type: 'RESIGN',
    };
  }

  return null;
}

function getTurnFromFen(fen: string): 'black' | 'white' {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

function toMoveRejectedReason(status: string): MoveRejectedReason {
  if (status === 'duplicate_move_id') {
    return 'DUPLICATE_MOVE_ID';
  }

  if (status === 'not_active') {
    return 'GAME_FINISHED';
  }

  if (status === 'not_participant') {
    return 'PLAYER_NOT_IN_GAME';
  }

  if (status === 'not_turn') {
    return 'NOT_YOUR_TURN';
  }

  return 'INVALID_MOVE';
}

export function attachWebSocketServer(server: Server) {
  const webSocketServer = new WebSocketServer({
    path: '/ws',
    server,
  });
  const rooms = new Map<string, Set<AuthenticatedSocket>>();

  function roomHasPlayer(room: Set<AuthenticatedSocket> | undefined, playerId: string) {
    if (!room) {
      return false;
    }

    for (const roomSocket of room) {
      if (roomSocket.player?.id === playerId) {
        return true;
      }
    }

    return false;
  }

  function broadcastToOtherPlayers(gameId: string, playerId: string, message: ServerMessage) {
    const room = rooms.get(gameId);

    if (!room) {
      return;
    }

    for (const roomSocket of room) {
      if (roomSocket.player?.id !== playerId) {
        send(roomSocket, message);
      }
    }
  }

  function joinRoom(socket: AuthenticatedSocket, gameId: string) {
    let room = rooms.get(gameId);
    const playerId = socket.player?.id;
    const wasPlayerInRoom = playerId ? roomHasPlayer(room, playerId) : false;

    if (!room) {
      room = new Set();
      rooms.set(gameId, room);
    }

    room.add(socket);
    socket.joinedGameIds?.add(gameId);

    return !wasPlayerInRoom;
  }

  function leaveAllRooms(socket: AuthenticatedSocket) {
    for (const gameId of socket.joinedGameIds ?? []) {
      const room = rooms.get(gameId);
      room?.delete(socket);

      if (socket.player && !roomHasPlayer(room, socket.player.id)) {
        broadcastToOtherPlayers(gameId, socket.player.id, {
          gameId,
          playerId: socket.player.id,
          type: 'PLAYER_DISCONNECTED',
        });
      }

      if (room?.size === 0) {
        rooms.delete(gameId);
      }
    }
  }

  function broadcastGameState(game: Game) {
    const room = rooms.get(game.id);

    if (!room) {
      return;
    }

    const connectedPlayerIds = Array.from(
      new Set(
        Array.from(room)
          .map((roomSocket) => roomSocket.player?.id)
          .filter((playerId): playerId is string => Boolean(playerId)),
      ),
    );

    for (const socket of room) {
      if (!socket.player) {
        continue;
      }

      send(socket, {
        game: {
          ...presentGameState(game, socket.player.id),
          connectedPlayerIds,
        },
        type: 'GAME_STATE',
      });
    }
  }

  function broadcastGameFinished(game: Game) {
    const room = rooms.get(game.id);

    if (!room) {
      return;
    }

    for (const socket of room) {
      if (!socket.player) {
        continue;
      }

      send(socket, {
        game: presentGameState(game, socket.player.id),
        gameId: game.id,
        result: game.result,
        type: 'GAME_FINISHED',
        winnerPlayerId: game.winnerPlayerId,
      });
    }
  }

  async function sendRejectedMove(
    socket: AuthenticatedSocket,
    gameId: string,
    moveId: string | undefined,
    reason: MoveRejectedReason,
  ) {
    const game = uuidPattern.test(gameId) ? await findGameById(gameId) : null;
    const gameState = game
      ? {
          fen: game.fen,
          turn: getTurnFromFen(game.fen),
        }
      : undefined;

    send(socket, {
      gameId,
      gameState,
      moveId,
      reason,
      type: 'MOVE_REJECTED',
    });
  }

  async function handleJoinGame(socket: AuthenticatedSocket, message: Extract<ClientMessage, { type: 'JOIN_GAME' }>) {
    if (!uuidPattern.test(message.gameId)) {
      send(socket, {
        error: {
          code: 'INVALID_MESSAGE',
          message: 'Game id is invalid',
        },
        type: 'ERROR',
      });
      return;
    }

    const game = await findGameById(message.gameId);

    if (!game || !socket.player || !getPlayerColor(game, socket.player.id)) {
      send(socket, {
        error: {
          code: 'FORBIDDEN',
          message: 'Player is not a participant in this game',
        },
        type: 'ERROR',
      });
      return;
    }

    const playerWasOffline = joinRoom(socket, game.id);

    for (const roomSocket of rooms.get(game.id) ?? []) {
      send(roomSocket, {
        gameId: game.id,
        nickname: socket.player.nickname,
        playerId: socket.player.id,
        type: 'PLAYER_JOINED',
      });
    }

    if (playerWasOffline) {
      broadcastToOtherPlayers(game.id, socket.player.id, {
        gameId: game.id,
        playerId: socket.player.id,
        type: 'PLAYER_RECONNECTED',
      });
    }

    broadcastGameState(game);
  }

  async function handleMove(socket: AuthenticatedSocket, message: Extract<ClientMessage, { type: 'MOVE' }>) {
    if (
      !uuidPattern.test(message.gameId) ||
      !uuidPattern.test(message.moveId) ||
      !squarePattern.test(message.from) ||
      !squarePattern.test(message.to)
    ) {
      await sendRejectedMove(socket, message.gameId, message.moveId, 'INVALID_MOVE');
      return;
    }

    if (!socket.player) {
      send(socket, {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Socket is not authenticated',
        },
        type: 'ERROR',
      });
      return;
    }

    const result = await playMove(message.gameId, socket.player.id, {
      from: message.from,
      moveId: message.moveId,
      promotion: message.promotion,
      to: message.to,
    });

    if (result.status !== 'played' && result.status !== 'duplicate') {
      await sendRejectedMove(socket, message.gameId, message.moveId, toMoveRejectedReason(result.status));
      return;
    }

    send(socket, {
      duplicate: result.status === 'duplicate',
      fen: result.game.fen,
      from: message.from,
      gameId: result.game.id,
      moveId: message.moveId,
      san: result.move.san,
      to: message.to,
      turn: getTurnFromFen(result.game.fen),
      type: 'MOVE_ACCEPTED',
    });

    if (result.game.status === 'FINISHED') {
      publishGameFinished(result.game);
    } else {
      publishGameStateUpdated(result.game);
    }
  }

  async function handleResign(socket: AuthenticatedSocket, message: Extract<ClientMessage, { type: 'RESIGN' }>) {
    if (!uuidPattern.test(message.gameId)) {
      send(socket, {
        error: {
          code: 'INVALID_MESSAGE',
          message: 'Game id is invalid',
        },
        type: 'ERROR',
      });
      return;
    }

    if (!socket.player) {
      send(socket, {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Socket is not authenticated',
        },
        type: 'ERROR',
      });
      return;
    }

    const result = await resignGame(message.gameId, socket.player.id);

    if (result.status === 'not_found') {
      send(socket, {
        error: {
          code: 'GAME_NOT_FOUND',
          message: 'Game not found',
        },
        type: 'ERROR',
      });
      return;
    }

    if (result.status === 'not_participant') {
      send(socket, {
        error: {
          code: 'FORBIDDEN',
          message: 'Player is not a participant in this game',
        },
        type: 'ERROR',
      });
      return;
    }

    if (result.status === 'not_active') {
      send(socket, {
        error: {
          code: 'GAME_NOT_ACTIVE',
          message: 'Game is not active',
        },
        type: 'ERROR',
      });
      return;
    }

    publishGameFinished(result.game);
  }

  async function handleMessage(socket: AuthenticatedSocket, rawMessage: Buffer | ArrayBuffer | Buffer[]) {
    const parsedMessage = parseClientMessage(parseJson(rawMessage));

    if (!parsedMessage) {
      send(socket, {
        error: {
          code: 'INVALID_MESSAGE',
          message: 'Message must be valid JSON and match the WebSocket protocol',
        },
        type: 'ERROR',
      });
      return;
    }

    if (parsedMessage.type === 'PING') {
      send(socket, { type: 'PONG' });
      return;
    }

    if (parsedMessage.type === 'JOIN_GAME') {
      await handleJoinGame(socket, parsedMessage);
      return;
    }

    if (parsedMessage.type === 'MOVE') {
      await handleMove(socket, parsedMessage);
      return;
    }

    await handleResign(socket, parsedMessage);
  }

  webSocketServer.on('connection', (socket: AuthenticatedSocket, request) => {
    socket.joinedGameIds = new Set();
    const pendingMessages: Array<Buffer | ArrayBuffer | Buffer[]> = [];
    let isAuthenticated = false;

    function processMessage(rawMessage: Buffer | ArrayBuffer | Buffer[]) {
      handleMessage(socket, rawMessage).catch(() => {
        send(socket, {
          error: {
            code: 'INVALID_MESSAGE',
            message: 'Message could not be processed',
          },
          type: 'ERROR',
        });
      });
    }

    socket.on('message', (rawMessage) => {
      if (!isAuthenticated) {
        pendingMessages.push(rawMessage);
        return;
      }

      processMessage(rawMessage);
    });

    authenticateSocket(request)
      .then((player) => {
        if (!player) {
          send(socket, {
            error: {
              code: 'UNAUTHORIZED',
              message: 'Invalid WebSocket token',
            },
            type: 'ERROR',
          });
          socket.close(1008, 'Unauthorized');
          return;
        }

        socket.player = player;
        isAuthenticated = true;

        for (const pendingMessage of pendingMessages.splice(0)) {
          processMessage(pendingMessage);
        }
      })
      .catch(() => {
        send(socket, {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid WebSocket token',
          },
          type: 'ERROR',
        });
        socket.close(1008, 'Unauthorized');
      });

    socket.on('close', () => {
      leaveAllRooms(socket);
    });
  });

  const unsubscribeGameEvents = subscribeGameEvents((event) => {
    if (event.type === 'GAME_FINISHED') {
      broadcastGameFinished(event.game);
      broadcastGameState(event.game);
      return;
    }

    broadcastGameState(event.game);
  });

  webSocketServer.on('close', () => {
    unsubscribeGameEvents();
  });

  return webSocketServer;
}
