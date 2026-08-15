import { Router } from 'express';

import { env, isProduction } from '../config/env.js';
import { checkDatabaseConnection } from '../db/pool.js';

export const healthRouter = Router();

function checkAuthConfiguration() {
  return env.jwtSecret && env.jwtSecret !== 'replace-with-a-long-random-secret' ? 'ok' : 'not_configured';
}

healthRouter.get('/health', async (_request, response, next) => {
  try {
    const database = await checkDatabaseConnection();
    const auth = checkAuthConfiguration();
    const isHealthy = database === 'ok' && auth === 'ok';

    response.status(isProduction && !isHealthy ? 503 : 200).json({
      auth,
      database,
      status: isHealthy ? 'ok' : 'degraded',
    });
  } catch (error) {
    next(error);
  }
});
