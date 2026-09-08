import jwt from 'jsonwebtoken';
import { ErrorCode } from '../errors/error-codes';

export type AccessTokenErrorCode = typeof ErrorCode.ACCESS_TOKEN_EXPIRED | typeof ErrorCode.ACCESS_TOKEN_INVALID;

/**
 * Classifies a jwt.verify() failure identically for both REST (middleware/auth.ts) and Socket.io
 * (realtime/socket-auth.ts), so a client only ever attempts a refresh-and-retry/reconnect for a
 * token that has genuinely expired — never for one that's malformed, wrongly signed, or otherwise
 * tampered with, where refreshing wouldn't help and silently retrying could mask a real problem.
 */
export function classifyAccessTokenError(err: unknown): AccessTokenErrorCode {
  return err instanceof jwt.TokenExpiredError ? ErrorCode.ACCESS_TOKEN_EXPIRED : ErrorCode.ACCESS_TOKEN_INVALID;
}
