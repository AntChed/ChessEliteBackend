import { Router } from 'express';

import { requireAuth } from '../auth/auth.middleware.js';
import { signPlayerToken } from '../auth/tokens.js';
import { sendApiError } from '../http/errors.js';
import { createRateLimit, playerOrIpRateLimitKey } from '../http/rateLimit.js';
import { logInfo } from '../logging/logger.js';
import {
  createAnonymousPlayer,
  updatePlayerNickname,
} from './player.repository.js';
import { createDefaultNickname, validateNickname } from './nickname.js';
import { presentPlayer } from './player.presenter.js';

export const playerRouter = Router();

const createAnonymousPlayerRateLimit = createRateLimit({
  keyPrefix: 'players:anonymous',
  maxRequests: 30,
  windowMs: 10 * 60 * 1000,
});
const updatePlayerRateLimit = createRateLimit({
  keyGenerator: playerOrIpRateLimitKey,
  keyPrefix: 'players:me',
  maxRequests: 30,
  windowMs: 60 * 1000,
});

playerRouter.post('/anonymous', createAnonymousPlayerRateLimit, async (_request, response, next) => {
  try {
    const player = await createAnonymousPlayer(createDefaultNickname());
    const token = signPlayerToken(player);

    logInfo('PLAYER_CREATED', {
      playerId: player.id,
    });

    response.status(201).json({
      player: presentPlayer(player),
      token,
    });
  } catch (error) {
    next(error);
  }
});

playerRouter.patch('/me', requireAuth, updatePlayerRateLimit, async (request, response, next) => {
  const validation = validateNickname(request.body?.nickname);

  if (!validation.success) {
    sendApiError(response, 400, validation.code, validation.message);
    return;
  }

  try {
    const player = await updatePlayerNickname(request.player!.id, validation.nickname);

    if (!player) {
      sendApiError(response, 404, 'NOT_FOUND', 'Player not found');
      return;
    }

    logInfo('PLAYER_UPDATED', {
      playerId: player.id,
    });

    response.json({
      player: presentPlayer(player),
    });
  } catch (error) {
    next(error);
  }
});
