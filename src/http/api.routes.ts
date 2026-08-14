import { Router } from 'express';

import { sendApiError } from './errors.js';

export const apiRouter = Router();

apiRouter.get('/', (_request, response) => {
  response.json({
    name: 'Chess Elite API',
    status: 'ok',
    version: '0.1.0',
  });
});

apiRouter.post('/players/anonymous', (_request, response) => {
  sendApiError(response, 501, 'NOT_IMPLEMENTED', 'Anonymous player creation is not implemented yet');
});

apiRouter.patch('/players/me', (_request, response) => {
  sendApiError(response, 501, 'NOT_IMPLEMENTED', 'Nickname update is not implemented yet');
});

apiRouter.post('/games', (_request, response) => {
  sendApiError(response, 501, 'NOT_IMPLEMENTED', 'Game creation is not implemented yet');
});

apiRouter.post('/games/join', (_request, response) => {
  sendApiError(response, 501, 'NOT_IMPLEMENTED', 'Game join is not implemented yet');
});

apiRouter.get('/games/:gameId', (_request, response) => {
  sendApiError(response, 501, 'NOT_IMPLEMENTED', 'Game state retrieval is not implemented yet');
});

apiRouter.post('/games/:gameId/resign', (_request, response) => {
  sendApiError(response, 501, 'NOT_IMPLEMENTED', 'Resignation is not implemented yet');
});

