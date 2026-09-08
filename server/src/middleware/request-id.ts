import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithRequestId } from '../utils/request-context';
import { logger } from '../utils/logger';

export const REQUEST_ID_HEADER = 'X-Request-ID';

/**
 * Deliberately a plain safe-charset allowlist, not a UUID-only check: callers (a mobile client, a
 * future upstream proxy/load balancer) may legitimately generate IDs in their own format. What
 * matters for safety is that whatever they send is bounded in length and contains nothing that
 * could break a log line or downstream header value — not that it matches one specific ID scheme.
 */
const MAX_REQUEST_ID_LENGTH = 128;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

function extractIncomingRequestId(req: Request): string | undefined {
  const header = req.headers['x-request-id'];
  // A client sending the header twice is already unusual; rather than guess which one to trust,
  // treat it as untrusted input and mint a fresh ID instead of picking either.
  if (Array.isArray(header)) {
    return undefined;
  }
  if (typeof header === 'string' && header.length <= MAX_REQUEST_ID_LENGTH && REQUEST_ID_PATTERN.test(header)) {
    return header;
  }
  return undefined;
}

/** Health endpoints (Phase 2.6.6) can be polled by infrastructure every few seconds — logging one
 * access-log line per successful poll would drown out everything else in the logs for zero
 * operational value. The request still gets a real request ID and header either way; this only
 * skips the routine per-request info line for these specific paths. A readiness *failure* still
 * gets its own explicit warn log from health.routes.ts. */
function isHealthCheckPath(path: string): boolean {
  return path === '/health' || path.startsWith('/health/');
}

/**
 * Reads (or mints) a request ID and makes it available for the rest of the request's lifetime —
 * both directly on `req.requestId` for handlers/middleware that already have `req` in scope, and
 * via runWithRequestId's AsyncLocalStorage context for deeper service/utility code that doesn't
 * receive `req` at all (see request-context.ts). Mounted early in app.ts, before body parsing and
 * rate limiting, so every response — including 400s from a malformed body or a 429 from the rate
 * limiter — still carries the header.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = extractIncomingRequestId(req) ?? crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);

  runWithRequestId(requestId, () => {
    if (!isHealthCheckPath(req.path)) {
      logger.info(`${req.method} ${req.path}`);
    }
    next();
  });
}
