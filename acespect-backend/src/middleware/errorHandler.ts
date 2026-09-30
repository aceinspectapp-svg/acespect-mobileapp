import { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError';
import { isProd } from '../config/env';

/** 404 for unmatched routes. */
export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

/**
 * Central error handler. Normalizes ApiError, Prisma errors, and unknown
 * errors into a consistent `{ error: { message, code, details? } }` shape.
 * Must be registered last, with four args so Express treats it as an
 * error handler.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let status = 500;
  let message = 'Internal server error';
  let code = 'INTERNAL_ERROR';
  let details: unknown;

  if (err instanceof ApiError) {
    status = err.statusCode;
    message = err.message;
    code = err.code;
    details = err.details;
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      status = 409;
      code = 'CONFLICT';
      message = 'A record with this value already exists';
    } else {
      status = 400;
      code = 'DB_REQUEST_ERROR';
      message = 'Database request error';
    }
  } else if (err instanceof Error && !isProd) {
    message = err.message;
  }

  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error('[error]', err);
  } else {
    // 4xx never used to be logged at all -- a mobile submission rejected by
    // validate() (schema mismatch, bad field) failed completely silently
    // server-side: the phone would queue it and retry forever, always
    // hitting the same rejection, with nothing in `railway logs` to show it
    // was even trying. Concise on purpose (no stack -- this isn't a bug in
    // this server, just a bad request), but enough to trace what and who.
    // eslint-disable-next-line no-console
    console.warn('[reject]', `${req.method} ${req.originalUrl}`, code, message, details ? JSON.stringify(details) : '');
  }

  res.status(status).json({
    error: {
      message,
      code,
      ...(details ? { details } : {}),
      ...(!isProd && err instanceof Error && status >= 500 ? { stack: err.stack } : {}),
    },
  });
}
