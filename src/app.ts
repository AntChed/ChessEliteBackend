import cors, { type CorsOptions } from 'cors';
import express from 'express';

import { env } from './config/env.js';
import { apiRouter } from './http/api.routes.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { healthRouter } from './http/health.routes.js';

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (env.allowedOrigins.length === 0 || !origin || env.allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(null, false);
  },
};

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(cors(corsOptions));
  app.use(express.json({ limit: '64kb' }));
  app.use(healthRouter);
  app.use('/api', apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
