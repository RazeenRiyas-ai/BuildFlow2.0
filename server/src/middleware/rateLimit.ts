import rateLimit, { type Options } from 'express-rate-limit';
import { ErrorCode } from '../errors/error-codes';

/**
 * express-rate-limit's own default handler sends a plain-text body (just the message string),
 * bypassing the rest of the API's JSON error contract entirely. This brings a 429 in line with
 * every other error response — same { error, code, requestId } shape (see errorHandler.ts) — by
 * building the body directly rather than throwing, since throwing from inside a rate-limit
 * handler would just be caught by the same errorHandler and reported as a generic 500 instead of
 * a 429. `request.requestId` is already set here: requestIdMiddleware runs before any rate limiter
 * (see app.ts).
 */
const handler: Options['handler'] = (request, response) => {
  response.status(429).json({
    error: 'Too many requests, please try again later.',
    code: ErrorCode.RATE_LIMITED,
    requestId: request.requestId,
  });
};

export const authRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

/** Separate, more generous limiter for /auth/refresh and /auth/logout: unlike register/login,
 * these aren't password-guessing surfaces (a refresh token isn't a guessable secret), so they
 * don't need the same tight ceiling — they still get bounded to blunt abuse/DoS. */
export const sessionRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});

export const globalRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler,
});
