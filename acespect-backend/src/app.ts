import express, { Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './config/env';
import { apiLimiter } from './middleware/rateLimit';
import { errorHandler, notFound } from './middleware/errorHandler';
import { authRouter } from './modules/auth/auth.routes';
import { inspectionsRouter } from './modules/inspections/inspections.routes';
import { reviewRouter } from './modules/review/review.routes';
import { templatesRouter } from './modules/templates/templates.routes';
import { webRouter } from './modules/web/web.routes';
import { mediaRouter } from './modules/media/media.routes';

export function createApp() {
  const app = express();

  // Security + parsing
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((s) => s.trim()),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  if (env.NODE_ENV !== 'test') app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  // Liveness — no DB dependency.
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'acespect-backend', timestamp: new Date().toISOString() });
  });

  // API v1 — media is exempt from the general rate limiter: a single report
  // page can load dozens of photos, which isn't the kind of traffic the
  // limiter exists to blunt.
  app.use('/api/v1/media', mediaRouter);
  app.use('/api/v1', apiLimiter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/inspections', inspectionsRouter);
  app.use('/api/v1/review', reviewRouter);
  app.use('/api/v1/templates', templatesRouter);
  app.use('/api/v1/web', webRouter);

  // Fallbacks
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
