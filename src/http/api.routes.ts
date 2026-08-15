import { Router } from 'express';

import { gameRouter } from '../games/game.routes.js';
import { playerRouter } from '../players/player.routes.js';

export const apiRouter = Router();

apiRouter.get('/', (_request, response) => {
  response.json({
    name: 'Chess Elite API',
    status: 'ok',
    version: '0.1.0',
  });
});

apiRouter.use('/players', playerRouter);
apiRouter.use('/games', gameRouter);
