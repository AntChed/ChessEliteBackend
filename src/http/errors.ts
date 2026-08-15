import type { ErrorRequestHandler, Request, Response } from 'express';

import { logError } from '../logging/logger.js';

export type ApiErrorCode =
  | 'AUTH_NOT_CONFIGURED'
  | 'DATABASE_NOT_CONFIGURED'
  | 'DUPLICATE_MOVE_ID'
  | 'FORBIDDEN'
  | 'GAME_NOT_ACTIVE'
  | 'GAME_FULL'
  | 'GAME_NOT_FOUND'
  | 'GAME_NOT_WAITING'
  | 'INVALID_COSMETIC'
  | 'INVALID_GAME_ID'
  | 'INVALID_JOIN_CODE'
  | 'INVALID_MOVE'
  | 'INVALID_MOVE_ID'
  | 'INVALID_NICKNAME'
  | 'INTERNAL_ERROR'
  | 'NOT_FOUND'
  | 'NOT_IMPLEMENTED'
  | 'PLAYER_ALREADY_IN_GAME'
  | 'PLAYER_NOT_IN_GAME'
  | 'RATE_LIMITED'
  | 'NOT_YOUR_TURN'
  | 'UNAUTHORIZED';

export type ApiErrorResponse = {
  error: {
    code: ApiErrorCode;
    message: string;
  };
};

export function sendApiError(response: Response, status: number, code: ApiErrorCode, message: string) {
  response.status(status).json({
    error: {
      code,
      message,
    },
  } satisfies ApiErrorResponse);
}

export function notFoundHandler(request: Request, response: Response) {
  sendApiError(response, 404, 'NOT_FOUND', `Route ${request.method} ${request.path} not found`);
}

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof Error && error.message.startsWith('DATABASE_URL is required')) {
    sendApiError(response, 503, 'DATABASE_NOT_CONFIGURED', error.message);
    return;
  }

  if (error instanceof Error && error.message === 'JWT_SECRET is required') {
    sendApiError(response, 503, 'AUTH_NOT_CONFIGURED', error.message);
    return;
  }

  logError('INTERNAL_ERROR', {
    message: error instanceof Error ? error.message : 'Unknown error',
  });
  sendApiError(response, 500, 'INTERNAL_ERROR', 'Internal server error');
};
