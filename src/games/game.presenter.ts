import type { Game, PlayerColor } from './game.types.js';

function getTurnFromFen(fen: string): PlayerColor {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

export function getPlayerColor(game: Game, playerId: string): PlayerColor | null {
  if (game.whitePlayerId === playerId) {
    return 'white';
  }

  if (game.blackPlayerId === playerId) {
    return 'black';
  }

  return null;
}

export function presentGameSummary(game: Game, playerId: string) {
  return {
    blackPieceSkinId: game.blackPieceSkinId,
    boardSkinId: game.boardSkinId,
    color: getPlayerColor(game, playerId),
    id: game.id,
    joinCode: game.joinCode,
    status: game.status,
    whitePieceSkinId: game.whitePieceSkinId,
  };
}

export function presentGameState(game: Game, playerId: string) {
  return {
    black: game.black,
    blackPieceSkinId: game.blackPieceSkinId,
    boardSkinId: game.boardSkinId,
    color: getPlayerColor(game, playerId),
    fen: game.fen,
    id: game.id,
    joinCode: game.joinCode,
    result: game.result,
    status: game.status,
    turn: getTurnFromFen(game.fen),
    version: game.version,
    white: game.white,
    whitePieceSkinId: game.whitePieceSkinId,
    winnerPlayerId: game.winnerPlayerId,
  };
}
