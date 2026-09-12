import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/app-error';
import { ErrorCode } from '../errors/error-codes';
import { logger } from '../utils/logger';
import { captureError } from '../observability/sentry';

/**
 * The response body shape is intentionally unchanged from before Phase 2.6.5: `error` (a string
 * message), `code` (a stable machine-readable discriminator), `details` (optional safe metadata).
 * The frontend's api-client.ts already parses exactly this flat shape (`body?.error`, `body?.code`,
 * `body?.details`) and format-error.ts pattern-matches the literal string `'ValidationError'` — a
 * nested `{ error: { code, message } }` shape, however tempting to introduce fresh, would silently
 * break both. `requestId` is the only new field, added additively everywhere.
 */
interface ErrorResponseBody {
  error: string;
  code?: string;
  details?: unknown;
  requestId?: string;
}

function buildBody(message: string, code: string | undefined, details: unknown, req: Request): ErrorResponseBody {
  const body: ErrorResponseBody = { error: message, code };
  if (details !== undefined) body.details = details;
  if (req.requestId) body.requestId = req.requestId;
  return body;
}

/** node-postgres's DatabaseError shape for a constraint violation — duck-typed rather than
 * imported from 'pg' so this stays a plain structural check, not a dependency on pg's error
 * classes. 23505 is the SQLSTATE for unique_violation. Deliberately the only database error this
 * handler translates: see errorHandler's own module doc below for why. */
function isUniqueViolation(err: unknown): err is { code: string; constraint?: string; table?: string } {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
}

/**
 * requestId is already set on the response header by requestIdMiddleware (app.ts mounts it before
 * every route), which runs before any of these branches — an error response carries the same
 * X-Request-ID header as a success response would have. It is now also mirrored into the JSON body
 * (Phase 2.6.5) so a client/operator can correlate without needing to read response headers.
 *
 * Only one database-error condition is translated here (a unique-constraint violation, into a
 * generic CONFLICT) — the one explicitly called out as worth handling generically. Every other
 * database error (syntax errors, connection failures, unknown constraints) falls through to the
 * generic unexpected-error branch: deliberately not building out a large database-error taxonomy,
 * per this phase's scope. The raw error, in all cases, only ever reaches the structured logger,
 * never the client.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    // 'ValidationError' is preserved byte-for-byte: src/utils/format-error.ts (frontend) matches
    // this exact string to show a friendly validation message. Do not reword it.
    logger.warn('Request validation failed', { code: ErrorCode.VALIDATION_ERROR, path: req.path });
    res.status(400).json(buildBody('ValidationError', ErrorCode.VALIDATION_ERROR, err.flatten(), req));
    return;
  }

  if (err instanceof AppError) {
    logger.warn(err.message, { code: err.code, statusCode: err.statusCode, path: req.path });
    // Every named AppError subclass today is 4xx (see app-error.ts) — this branch exists so a
    // future 5xx-shaped AppError is reported without needing another change to this file.
    if (err.statusCode >= 500) {
      captureError(err, { tags: { requestId: req.requestId ?? '', path: req.path, method: req.method } });
    }
    res.status(err.statusCode).json(buildBody(err.message, err.code, err.details, req));
    return;
  }

  if (isUniqueViolation(err)) {
    // err.detail (if present) can contain the actual conflicting value (e.g. a phone number) —
    // deliberately never logged. constraint/table names are just schema metadata, safe to log.
    logger.warn('Database unique constraint violation', {
      code: ErrorCode.CONFLICT,
      constraint: err.constraint,
      table: err.table,
      path: req.path,
    });
    res.status(409).json(buildBody('A conflicting record already exists', ErrorCode.CONFLICT, undefined, req));
    return;
  }

  logger.error(`Unhandled error on ${req.method} ${req.path}`, err, { code: ErrorCode.INTERNAL_ERROR });
  captureError(err, { tags: { requestId: req.requestId ?? '', path: req.path, method: req.method } });
  res.status(500).json(buildBody('InternalServerError', ErrorCode.INTERNAL_ERROR, undefined, req));
}
