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

export type ServerMessage =
  | { type: 'PONG' }
  | {
      error: {
        code: 'NOT_IMPLEMENTED' | 'INVALID_MESSAGE';
        message: string;
      };
      type: 'ERROR';
    };

export function serializeServerMessage(message: ServerMessage) {
  return JSON.stringify(message);
}

