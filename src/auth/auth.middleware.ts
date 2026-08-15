import type { NextFunction, Request, Response } from 'express';

import { sendApiError } from '../http/errors.js';
import { findPlayerById, touchPlayerLastSeen } from '../players/player.repository.js';
import type { Player } from '../players/player.types.js';
import { verifyPlayerToken } from './tokens.js';

declare global {
  namespace Express {
    interface Request {
      player?: Player;
    }
  }
}

function readBearerToken(request: Request) {
  const authorization = request.header('authorization');

  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(' ');

  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

export async function requireAuth(request: Request, response: Response, next: NextFunction) {
  const token = readBearerToken(request);

  if (!token) {
    sendApiError(response, 401, 'UNAUTHORIZED', 'Missing bearer token');
    return;
  }

  try {
    const payload = verifyPlayerToken(token);
    const player = await findPlayerById(payload.playerId);

    if (!player || player.tokenVersion !== payload.tokenVersion) {
      sendApiError(response, 401, 'UNAUTHORIZED', 'Invalid bearer token');
      return;
    }

    request.player = player;
    touchPlayerLastSeen(player.id).catch(() => undefined);
    next();
  } catch {
    sendApiError(response, 401, 'UNAUTHORIZED', 'Invalid bearer token');
  }
}

