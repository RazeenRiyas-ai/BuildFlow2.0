import type { AccessTokenPayload } from './auth';

declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
      /** Set by requestIdMiddleware (middleware/request-id.ts) on every request — either the
       * caller-supplied X-Request-ID (if valid) or a freshly generated one. */
      requestId?: string;
    }
  }
}

export {};
