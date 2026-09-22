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
  // Logged before body-parsing so a payload-too-large rejection below still
  // shows up here -- express.json() throwing calls next(err), which skips
  // any regular middleware registered after it (morgan included), so a
  // rejected submit would otherwise leave zero trace in these logs.
  if (env.NODE_ENV !== 'test') app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  // A full multi-section inspection submit (every section's answers +
  // damages, no photo bytes -- those are separate uploads) can run well
  // past 1mb for a long/detailed report; that default was tight enough to
  // silently reject real submits.
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
