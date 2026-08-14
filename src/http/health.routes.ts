import { Router } from 'express';

import { checkDatabaseConnection } from '../db/pool.js';

export const healthRouter = Router();

healthRouter.get('/health', async (_request, response, next) => {
  try {
    const database = await checkDatabaseConnection();

    response.json({
      database,
      status: 'ok',
    });
  } catch (error) {
    next(error);
  }
});

