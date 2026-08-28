/**
 * `errorHandler` + `notFound` — the ONLY place in FlowBoard that formats an
 * error envelope. Everything else throws (`ApiError`) or forwards (`ZodError`);
 * one formatter is what keeps `{ success:false, error:{ code, message, details? } }`
 * true of every failing response, including the ones nobody wrote a handler for.
 *
 * Mapping:
 *   ApiError → its own status / code / details
 *   ZodError → 422 `validation_error` with per-field `{ path, code, message }`
 *   anything else → 500 `internal_error`
 *
 * 5xx `details` are withheld in production (a stack trace or a driver message is
 * a disclosure, not a diagnostic) and logged through pino instead — never
 * `console.error`, because the logger's second sink is the ring buffer behind
 * the diagnostics drawer, and a console write would make exactly the errors an
 * operator most needs invisible there.
 */
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { fail, type ErrorEnvelope } from '@flowboard/shared';
import { isProduction } from '../config/env';
import { ApiError } from '../utils/api-error';
import { logger } from '../utils/logger';

/** 404 for unmatched routes — mounted after every router, before errorHandler. */
export const notFound: RequestHandler = (req, _res, next) => {
  next(ApiError.notFound(`Cannot ${req.method} ${req.path}`));
};

interface ResolvedError {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/** One field-level validation failure, as the web form binder consumes it. */
interface ValidationIssueDetail {
  path: string;
  code: string;
  message: string;
}

function resolve(err: unknown): ResolvedError {
  if (err instanceof ApiError) {
    return { status: err.status, code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof ZodError) {
    const details: ValidationIssueDetail[] = err.issues.map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code,
      message: issue.message,
    }));
    return { status: 422, code: 'validation_error', message: 'Validation failed', details };
  }
  return { status: 500, code: 'internal_error', message: 'Internal server error' };
}

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  // A stream that already started (a presigned redirect, an aborted response)
  // cannot be re-rendered as an envelope; hand it to Express' default handler,
  // which closes the connection.
  if (res.headersSent) {
    next(err);
    return;
  }

  const { status, code, message, details } = resolve(err);

  if (status >= 500) {
    logger.error(
      { err, method: req.method, path: req.originalUrl, userId: req.user?.id ?? null },
      'Unhandled error',
    );
  }

  // 4xx details are ours and safe to return. 5xx details are only ever shown
  // outside production.
  const exposeDetails = details !== undefined && (status < 500 || !isProduction);

  const body: ErrorEnvelope = fail({
    code,
    message,
    ...(exposeDetails ? { details } : {}),
  });

  res.status(status).json(body);
};
