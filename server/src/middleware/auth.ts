import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { UnauthorizedError, ForbiddenError } from '../utils/app-error';
import { classifyAccessTokenError } from '../utils/access-token-error';
import { ErrorCode } from '../errors/error-codes';
import type { AccessTokenPayload, UserRole } from '../types/auth';

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing bearer token', ErrorCode.MISSING_TOKEN);
  }

  const token = header.slice('Bearer '.length);
  try {
    // Deliberately a pure signature/expiry check — no DB lookup here. Session-level invalidation
    // (disabled accounts, token_version bumps) is enforced only at /auth/refresh; see auth.service.ts.
    req.user = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
    next();
  } catch (err) {
    const code = classifyAccessTokenError(err);
    throw new UnauthorizedError(code === ErrorCode.ACCESS_TOKEN_EXPIRED ? 'Access token has expired' : 'Invalid access token', code);
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new ForbiddenError('Insufficient role for this action', ErrorCode.INSUFFICIENT_ROLE);
    }
    next();
  };
}
