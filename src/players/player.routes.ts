import { Router } from 'express';

import { requireAuth } from '../auth/auth.middleware.js';
import { signPlayerToken } from '../auth/tokens.js';
import { sendApiError } from '../http/errors.js';
import {
  createAnonymousPlayer,
  updatePlayerNickname,
} from './player.repository.js';
import { createDefaultNickname, validateNickname } from './nickname.js';
import { presentPlayer } from './player.presenter.js';

export const playerRouter = Router();

playerRouter.post('/anonymous', async (_request, response, next) => {
  try {
    const player = await createAnonymousPlayer(createDefaultNickname());
    const token = signPlayerToken(player);

    response.status(201).json({
      player: presentPlayer(player),
      token,
    });
  } catch (error) {
    next(error);
  }
});

playerRouter.patch('/me', requireAuth, async (request, response, next) => {
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

    response.json({
      player: presentPlayer(player),
    });
  } catch (error) {
    next(error);
  }
});

