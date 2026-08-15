import { Router } from 'express';

import { requireAuth } from '../auth/auth.middleware.js';
import { sendApiError } from '../http/errors.js';
import { createRateLimit, playerOrIpRateLimitKey } from '../http/rateLimit.js';
import { logInfo, logWarn } from '../logging/logger.js';
import { publishGameFinished, publishGameStateUpdated } from './gameEvents.js';
import { createGame, findGameById, joinGameByCode, playMove, resignGame } from './game.repository.js';
import { getPlayerColor, presentGameState, presentGameSummary } from './game.presenter.js';
import { isValidJoinCode, normalizeJoinCode } from './joinCode.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const squarePattern = /^[a-h][1-8]$/;
const promotionPattern = /^[bnqr]$/;
const cosmeticIdPattern = /^[A-Za-z0-9_-]{1,64}$/;

export const gameRouter = Router();

gameRouter.use(requireAuth);

const createGameRateLimit = createRateLimit({
  keyGenerator: playerOrIpRateLimitKey,
  keyPrefix: 'games:create',
  maxRequests: 20,
  windowMs: 60 * 1000,
});
const joinGameRateLimit = createRateLimit({
  keyGenerator: playerOrIpRateLimitKey,
  keyPrefix: 'games:join',
  maxRequests: 30,
  windowMs: 60 * 1000,
});
const moveRateLimit = createRateLimit({
  keyGenerator: playerOrIpRateLimitKey,
  keyPrefix: 'games:moves',
  maxRequests: 120,
  windowMs: 10 * 1000,
});
const resignRateLimit = createRateLimit({
  keyGenerator: playerOrIpRateLimitKey,
  keyPrefix: 'games:resign',
  maxRequests: 10,
  windowMs: 60 * 1000,
});

function normalizeCosmeticId(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return typeof value === 'string' ? value.trim() : null;
}

function validateCosmeticId(value: string | null) {
  return value === null || cosmeticIdPattern.test(value);
}

gameRouter.post('/', createGameRateLimit, async (request, response, next) => {
  const chessSkinId = normalizeCosmeticId(request.body?.chessSkinId);

  if (!validateCosmeticId(chessSkinId)) {
    sendApiError(response, 400, 'INVALID_COSMETIC', 'Cosmetic selection is invalid');
    return;
  }

  try {
    const game = await createGame(request.player!.id, chessSkinId);

    logInfo('GAME_CREATED', {
      gameId: game.id,
      playerId: request.player!.id,
    });

    response.status(201).json({
      game: presentGameSummary(game, request.player!.id),
    });
  } catch (error) {
    next(error);
  }
});

gameRouter.post('/join', joinGameRateLimit, async (request, response, next) => {
  const joinCode = normalizeJoinCode(request.body?.joinCode);
  const chessSkinId = normalizeCosmeticId(request.body?.chessSkinId);

  if (!isValidJoinCode(joinCode)) {
    sendApiError(response, 400, 'INVALID_JOIN_CODE', 'Join code is invalid');
    return;
  }

  if (!validateCosmeticId(chessSkinId)) {
    sendApiError(response, 400, 'INVALID_COSMETIC', 'Cosmetic selection is invalid');
    return;
  }

  try {
    const result = await joinGameByCode(joinCode, request.player!.id, chessSkinId);

    if (result.status === 'not_found') {
      logWarn('PLAYER_JOIN_REJECTED', {
        playerId: request.player!.id,
        reason: result.status,
      });
      sendApiError(response, 404, 'GAME_NOT_FOUND', 'Game not found');
      return;
    }

    if (result.status === 'already_participant') {
      logWarn('PLAYER_JOIN_REJECTED', {
        playerId: request.player!.id,
        reason: result.status,
      });
      sendApiError(response, 409, 'PLAYER_ALREADY_IN_GAME', 'Player is already in this game');
      return;
    }

    if (result.status === 'not_waiting') {
      logWarn('PLAYER_JOIN_REJECTED', {
        playerId: request.player!.id,
        reason: result.status,
      });
      sendApiError(response, 409, 'GAME_NOT_WAITING', 'Game is not waiting for an opponent');
      return;
    }

    if (result.status === 'full') {
      logWarn('PLAYER_JOIN_REJECTED', {
        playerId: request.player!.id,
        reason: result.status,
      });
      sendApiError(response, 409, 'GAME_FULL', 'Game is full');
      return;
    }

    logInfo('PLAYER_JOINED', {
      gameId: result.game.id,
      playerId: request.player!.id,
    });

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

gameRouter.post('/:gameId/moves', moveRateLimit, async (request, response, next) => {
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
    logInfo('MOVE_RECEIVED', {
      from,
      gameId: request.params.gameId,
      moveId,
      playerId: request.player!.id,
      to,
    });

    const result = await playMove(request.params.gameId, request.player!.id, {
      from,
      moveId,
      promotion,
      to,
    });

    if (result.status === 'not_found') {
      logWarn('MOVE_REJECTED', {
        gameId: request.params.gameId,
        moveId,
        playerId: request.player!.id,
        reason: result.status,
      });
      sendApiError(response, 404, 'GAME_NOT_FOUND', 'Game not found');
      return;
    }

    if (result.status === 'not_participant') {
      logWarn('MOVE_REJECTED', {
        gameId: request.params.gameId,
        moveId,
        playerId: request.player!.id,
        reason: result.status,
      });
      sendApiError(response, 403, 'PLAYER_NOT_IN_GAME', 'Player is not a participant in this game');
      return;
    }

    if (result.status === 'not_active') {
      logWarn('MOVE_REJECTED', {
        gameId: request.params.gameId,
        moveId,
        playerId: request.player!.id,
        reason: result.status,
      });
      sendApiError(response, 409, 'GAME_NOT_ACTIVE', 'Game is not active');
      return;
    }

    if (result.status === 'not_turn') {
      logWarn('MOVE_REJECTED', {
        gameId: request.params.gameId,
        moveId,
        playerId: request.player!.id,
        reason: result.status,
      });
      sendApiError(response, 409, 'NOT_YOUR_TURN', 'It is not your turn');
      return;
    }

    if (result.status === 'invalid_move') {
      logWarn('MOVE_REJECTED', {
        gameId: request.params.gameId,
        moveId,
        playerId: request.player!.id,
        reason: result.status,
      });
      sendApiError(response, 400, 'INVALID_MOVE', 'Move is invalid');
      return;
    }

    if (result.status === 'duplicate_move_id') {
      logWarn('MOVE_REJECTED', {
        gameId: request.params.gameId,
        moveId,
        playerId: request.player!.id,
        reason: result.status,
      });
      sendApiError(response, 409, 'DUPLICATE_MOVE_ID', 'Move id was already used');
      return;
    }

    logInfo('MOVE_ACCEPTED', {
      duplicate: result.status === 'duplicate',
      gameId: result.game.id,
      moveId,
      playerId: request.player!.id,
      result: result.game.status === 'FINISHED' ? result.game.result : undefined,
    });

    response.status(result.status === 'played' ? 201 : 200).json({
      duplicate: result.status === 'duplicate',
      game: presentGameState(result.game, request.player!.id),
      move: result.move,
    });

    if (result.game.status === 'FINISHED') {
      logInfo('GAME_FINISHED', {
        gameId: result.game.id,
        result: result.game.result,
        winnerPlayerId: result.game.winnerPlayerId,
      });
      publishGameFinished(result.game);
    } else {
      publishGameStateUpdated(result.game);
    }
  } catch (error) {
    next(error);
  }
});

gameRouter.post('/:gameId/resign', resignRateLimit, async (request, response, next) => {
  if (!uuidPattern.test(request.params.gameId)) {
    sendApiError(response, 400, 'INVALID_GAME_ID', 'Game id is invalid');
    return;
  }

  try {
    const result = await resignGame(request.params.gameId, request.player!.id);

    if (result.status === 'not_found') {
      logWarn('GAME_RESIGN_REJECTED', {
        gameId: request.params.gameId,
        playerId: request.player!.id,
        reason: result.status,
      });
      sendApiError(response, 404, 'GAME_NOT_FOUND', 'Game not found');
      return;
    }

    if (result.status === 'not_participant') {
      logWarn('GAME_RESIGN_REJECTED', {
        gameId: request.params.gameId,
        playerId: request.player!.id,
        reason: result.status,
      });
      sendApiError(response, 403, 'PLAYER_NOT_IN_GAME', 'Player is not a participant in this game');
      return;
    }

    if (result.status === 'not_active') {
      logWarn('GAME_RESIGN_REJECTED', {
        gameId: request.params.gameId,
        playerId: request.player!.id,
        reason: result.status,
      });
      sendApiError(response, 409, 'GAME_NOT_ACTIVE', 'Game is not active');
      return;
    }

    logInfo('GAME_FINISHED', {
      gameId: result.game.id,
      playerId: request.player!.id,
      result: result.game.result,
      winnerPlayerId: result.game.winnerPlayerId,
    });

    response.json({
      game: presentGameState(result.game, request.player!.id),
    });

    publishGameFinished(result.game);
  } catch (error) {
    next(error);
  }
});
