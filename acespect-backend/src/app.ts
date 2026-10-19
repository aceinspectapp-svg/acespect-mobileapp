import express, { Request, Response } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { auditContext } from './lib/auditTrail';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { apiLimiter } from './middleware/rateLimit';
import { clientIp } from './middleware/clientIp';
import { errorHandler, notFound } from './middleware/errorHandler';
import { authRouter } from './modules/auth/auth.routes';
import { inspectionsRouter } from './modules/inspections/inspections.routes';
import { reviewRouter } from './modules/review/review.routes';
import { templatesRouter } from './modules/templates/templates.routes';
import { webRouter } from './modules/web/web.routes';
import { mediaRouter } from './modules/media/media.routes';
import { qcRouter } from './modules/qc/qc.routes';
import { auditRouter } from './modules/audit/audit.routes';

export function createApp() {
  const app = express();

  // Security + parsing
  app.disable('x-powered-by');
  // Express's own guess at the visitor's address (one proxy hop assumed). Behind Railway that guess is unreliable -- it often lands on one of
  // Railway's own servers, shared by every visitor -- so clientIp (next) replaces it with the real address from X-Real-IP, which Railway's
  // edge sets on every request. This stays as the fallback where that header is not used.
  app.set('trust proxy', 1);
  app.use(clientIp);
  app.use(auditContext);
  app.use(helmet());
  // JSON answers compress to a fraction of their size (images, PDFs and other already-compressed files are skipped automatically).
  app.use(compression());
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

  // Readiness: the database answers and how quickly (for uptime monitors and the performance targets).
  app.get('/health/ready', async (_req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', dbMs: Date.now() - t0, timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded', dbMs: Date.now() - t0 });
    }
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
  app.use('/api/v1/audit', auditRouter);
  app.use('/api/v1/qc', qcRouter);

  // Fallbacks
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
