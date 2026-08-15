import type { Player } from '../players/player.types.js';

export type GameStatus = 'ACTIVE' | 'CANCELLED' | 'FINISHED' | 'WAITING';

export type GameResult =
  | 'BLACK_WIN'
  | 'CHECKMATE'
  | 'DRAW'
  | 'RESIGNATION'
  | 'STALEMATE'
  | 'WHITE_WIN';

export type PlayerColor = 'black' | 'white';

export type GameParticipant = Pick<Player, 'id' | 'nickname'>;

export type Game = {
  black: GameParticipant | null;
  blackPlayerId: string | null;
  blackPieceSkinId: string | null;
  boardSkinId: string | null;
  createdAt: Date;
  fen: string;
  id: string;
  joinCode: string;
  result: GameResult | null;
  status: GameStatus;
  updatedAt: Date;
  version: number;
  white: GameParticipant;
  whitePlayerId: string;
  whitePieceSkinId: string | null;
  winnerPlayerId: string | null;
};
