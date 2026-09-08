import jwt from 'jsonwebtoken';
import type { DefaultEventsMap, ExtendedError, Socket } from 'socket.io';
import { env } from '../config/env';
import { classifyAccessTokenError } from '../utils/access-token-error';
import type { AccessTokenPayload } from '../types/auth';
import type { SocketData } from './socket-types';

type AuthenticableSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

/**
 * Socket.io connection middleware — reuses the exact same JWT access-token verification as
 * requireAuth (middleware/auth.ts). There is no separate/second auth system: the client sends the
 * same access token it already uses for REST calls, and the identity attached to the socket (in
 * socket.data.user) always comes from the verified token, never from anything the client claims.
 *
 * The failure reason is attached as `err.data.code` (Socket.io's ExtendedError mechanism, which
 * survives to the client's own `connect_error` event) using the same ACCESS_TOKEN_EXPIRED /
 * ACCESS_TOKEN_INVALID vocabulary as REST, so the client can tell "worth refreshing and
 * reconnecting" apart from "malformed/tampered, refreshing won't help" exactly as it already does
 * for REST 401s.
 */
export function socketAuthMiddleware(socket: AuthenticableSocket, next: (err?: ExtendedError) => void) {
  const token = extractToken(socket);
  if (!token) {
    const err: ExtendedError = new Error('Unauthorized: missing token');
    err.data = { code: 'MISSING_TOKEN' };
    next(err);
    return;
  }

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
    socket.data.user = payload;
    next();
  } catch (verifyErr) {
    const code = classifyAccessTokenError(verifyErr);
    const err: ExtendedError = new Error(
      code === 'ACCESS_TOKEN_EXPIRED' ? 'Unauthorized: access token has expired' : 'Unauthorized: invalid access token',
    );
    err.data = { code };
    next(err);
  }
}

function extractToken(socket: AuthenticableSocket): string | null {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === 'string' && authToken.length > 0) {
    return authToken;
  }

  const header = socket.handshake.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length);
  }

  return null;
}
