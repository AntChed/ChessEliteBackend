import { Router } from 'express';

import { requireAuth } from '../auth/auth.middleware.js';
import { sendApiError } from '../http/errors.js';
import { publishGameFinished, publishGameStateUpdated } from './gameEvents.js';
import { createGame, findGameById, joinGameByCode, playMove, resignGame } from './game.repository.js';
import { getPlayerColor, presentGameState, presentGameSummary } from './game.presenter.js';
import { isValidJoinCode, normalizeJoinCode } from './joinCode.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const squarePattern = /^[a-h][1-8]$/;
const promotionPattern = /^[bnqr]$/;

export const gameRouter = Router();

gameRouter.use(requireAuth);

gameRouter.post('/', async (request, response, next) => {
  try {
    const game = await createGame(request.player!.id);

    response.status(201).json({
      game: presentGameSummary(game, request.player!.id),
    });
  } catch (error) {
    next(error);
  }
});

gameRouter.post('/join', async (request, response, next) => {
  const joinCode = normalizeJoinCode(request.body?.joinCode);

  if (!isValidJoinCode(joinCode)) {
    sendApiError(response, 400, 'INVALID_JOIN_CODE', 'Join code is invalid');
    return;
  }

  try {
    const result = await joinGameByCode(joinCode, request.player!.id);

    if (result.status === 'not_found') {
      sendApiError(response, 404, 'GAME_NOT_FOUND', 'Game not found');
      return;
    }

    if (result.status === 'already_participant') {
      sendApiError(response, 409, 'PLAYER_ALREADY_IN_GAME', 'Player is already in this game');
      return;
    }

    if (result.status === 'not_waiting') {
      sendApiError(response, 409, 'GAME_NOT_WAITING', 'Game is not waiting for an opponent');
      return;
    }

    if (result.status === 'full') {
      sendApiError(response, 409, 'GAME_FULL', 'Game is full');
      return;
    }

    publishGameStateUpdated(result.game);

    response.json({
      game: presentGameSummary(result.game, request.player!.id),
    });
  } catch (error) {
    next(error);
  }
});

gameRouter.get('/:gameId', async (request, response, next) => {
  if (!uuidPattern.test(request.params.gameId)) {
    sendApiError(response, 400, 'INVALID_GAME_ID', 'Game id is invalid');
    return;
  }

  try {
    const game = await findGameById(request.params.gameId);

    if (!game) {
      sendApiError(response, 404, 'GAME_NOT_FOUND', 'Game not found');
      return;
    }

    if (!getPlayerColor(game, request.player!.id)) {
      sendApiError(response, 403, 'FORBIDDEN', 'Player is not a participant in this game');
      return;
    }

    response.json({
      game: presentGameState(game, request.player!.id),
    });
  } catch (error) {
    next(error);
  }
});

gameRouter.post('/:gameId/moves', async (request, response, next) => {
  if (!uuidPattern.test(request.params.gameId)) {
    sendApiError(response, 400, 'INVALID_GAME_ID', 'Game id is invalid');
    return;
  }

  const moveId = typeof request.body?.moveId === 'string' ? request.body.moveId : '';
  const from = typeof request.body?.from === 'string' ? request.body.from : '';
  const to = typeof request.body?.to === 'string' ? request.body.to : '';
  const promotion = typeof request.body?.promotion === 'string' ? request.body.promotion : undefined;

  if (!uuidPattern.test(moveId)) {
    sendApiError(response, 400, 'INVALID_MOVE_ID', 'Move id is invalid');
    return;
  }

  if (!squarePattern.test(from) || !squarePattern.test(to)) {
    sendApiError(response, 400, 'INVALID_MOVE', 'Move squares are invalid');
    return;
  }

  if (promotion && !promotionPattern.test(promotion)) {
    sendApiError(response, 400, 'INVALID_MOVE', 'Promotion piece is invalid');
    return;
  }

  try {
    const result = await playMove(request.params.gameId, request.player!.id, {
      from,
      moveId,
      promotion,
      to,
    });

    if (result.status === 'not_found') {
      sendApiError(response, 404, 'GAME_NOT_FOUND', 'Game not found');
      return;
    }

    if (result.status === 'not_participant') {
      sendApiError(response, 403, 'PLAYER_NOT_IN_GAME', 'Player is not a participant in this game');
      return;
    }

    if (result.status === 'not_active') {
      sendApiError(response, 409, 'GAME_NOT_ACTIVE', 'Game is not active');
      return;
    }

    if (result.status === 'not_turn') {
      sendApiError(response, 409, 'NOT_YOUR_TURN', 'It is not your turn');
      return;
    }

    if (result.status === 'invalid_move') {
      sendApiError(response, 400, 'INVALID_MOVE', 'Move is invalid');
      return;
    }

    if (result.status === 'duplicate_move_id') {
      sendApiError(response, 409, 'DUPLICATE_MOVE_ID', 'Move id was already used');
      return;
    }

    response.status(result.status === 'played' ? 201 : 200).json({
      duplicate: result.status === 'duplicate',
      game: presentGameState(result.game, request.player!.id),
      move: result.move,
    });

    publishGameStateUpdated(result.game);
  } catch (error) {
    next(error);
  }
});

gameRouter.post('/:gameId/resign', async (request, response, next) => {
  if (!uuidPattern.test(request.params.gameId)) {
    sendApiError(response, 400, 'INVALID_GAME_ID', 'Game id is invalid');
    return;
  }

  try {
    const result = await resignGame(request.params.gameId, request.player!.id);

    if (result.status === 'not_found') {
      sendApiError(response, 404, 'GAME_NOT_FOUND', 'Game not found');
      return;
    }

    if (result.status === 'not_participant') {
      sendApiError(response, 403, 'PLAYER_NOT_IN_GAME', 'Player is not a participant in this game');
      return;
    }

    if (result.status === 'not_active') {
      sendApiError(response, 409, 'GAME_NOT_ACTIVE', 'Game is not active');
      return;
    }

    response.json({
      game: presentGameState(result.game, request.player!.id),
    });

    publishGameFinished(result.game);
  } catch (error) {
    next(error);
  }
});
