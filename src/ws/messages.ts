import type { GameResult } from '../games/game.types.js';

export type ClientMessage =
  | { gameId: string; type: 'JOIN_GAME' }
  | {
      from: string;
      gameId: string;
      moveId: string;
      promotion?: 'b' | 'n' | 'q' | 'r';
      to: string;
      type: 'MOVE';
    }
  | { gameId: string; type: 'RESIGN' }
  | { type: 'PING' };

export type MoveRejectedReason =
  | 'DUPLICATE_MOVE_ID'
  | 'GAME_FINISHED'
  | 'INVALID_MOVE'
  | 'NOT_YOUR_TURN'
  | 'OUT_OF_SYNC'
  | 'PLAYER_NOT_IN_GAME';

export type ServerMessage =
  | { type: 'PONG' }
  | {
      game: unknown;
      type: 'GAME_STATE';
    }
  | {
      gameId: string;
      playerId: string;
      nickname?: string;
      type: 'PLAYER_JOINED';
    }
  | {
      gameId: string;
      playerId: string;
      type: 'PLAYER_DISCONNECTED';
    }
  | {
      gameId: string;
      playerId: string;
      type: 'PLAYER_RECONNECTED';
    }
  | {
      game: unknown;
      gameId: string;
      result: GameResult | null;
      type: 'GAME_FINISHED';
      winnerPlayerId: string | null;
    }
  | {
      duplicate: boolean;
      fen: string;
      from: string;
      gameId: string;
      moveId: string;
      san: string;
      to: string;
      turn: 'black' | 'white';
      type: 'MOVE_ACCEPTED';
    }
  | {
      gameState?: {
        fen: string;
        turn: 'black' | 'white';
      };
      gameId?: string;
      moveId?: string;
      reason: MoveRejectedReason;
      type: 'MOVE_REJECTED';
    }
  | {
      error: {
        code:
          | 'FORBIDDEN'
          | 'GAME_NOT_ACTIVE'
          | 'GAME_NOT_FOUND'
          | 'INVALID_MESSAGE'
          | 'NOT_IMPLEMENTED'
          | 'UNAUTHORIZED';
        message: string;
      };
      type: 'ERROR';
    };

export function serializeServerMessage(message: ServerMessage) {
  return JSON.stringify(message);
}
