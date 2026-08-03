import express, { type Express } from 'express';
import { buildRouter } from './routes';
import { errorHandler } from './middleware';

/**
 * Assemble the Financial Core HTTP app. All endpoints live under /api/v1. Money never appears as a
 * JSON number — amounts are decimal strings in and out.
 */
export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.use('/api/v1', buildRouter());
  app.use(errorHandler);
  return app;
}
