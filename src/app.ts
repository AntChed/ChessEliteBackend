import cors from 'cors';
import express from 'express';

import { apiRouter } from './http/api.routes.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { healthRouter } from './http/health.routes.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '64kb' }));
  app.use(healthRouter);
  app.use('/api', apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

