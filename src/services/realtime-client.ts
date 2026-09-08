import { io, Socket } from 'socket.io-client';

import { getAccessToken, refreshSession } from '@/services/session-manager';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Matches the `code` the backend attaches to a connect_error's `.data` (see
 * server/src/realtime/socket-auth.ts) — the same ACCESS_TOKEN_EXPIRED / ACCESS_TOKEN_INVALID /
 * MISSING_TOKEN vocabulary used for REST 401s. */
interface SocketAuthConnectError extends Error {
  data?: { code?: string };
}

let socket: Socket | null = null;

/**
 * One realtime connection for the whole app, created after login/register/silent-refresh and torn
 * down on logout (see auth-context.tsx). The token is read fresh from secure storage on every
 * connection attempt (initial connect and every automatic reconnect) rather than captured once at
 * connect time, so a socket that reconnects after this app session's token has changed always
 * authenticates with whatever is currently valid instead of a stale closed-over string.
 */
export function connectRealtime(): Socket {
  disconnectRealtime();

  const newSocket = io(API_BASE_URL, {
    transports: ['websocket'],
    auth: (cb) => {
      getAccessToken()
        .then((token) => cb({ token }))
        .catch(() => cb({}));
    },
  });
  socket = newSocket;

  // Guards against triggering more than one refresh attempt for the same outstanding nudge — set
  // the instant a refresh starts, cleared the instant it settles one way or the other:
  //  - on a TRANSIENT (network/timeout) failure, cleared immediately in .catch() below, so the
  //    very next connect_error (Socket.io's own automatic reconnection, already paced by its own
  //    backoff) gets a fresh chance to refresh and recover. This is deliberate: clearing the flag
  //    only on a successful 'connect' — as an earlier version of this file did — would strand the
  //    socket forever the moment a single refresh attempt hit a network blip, since with the token
  //    still expired, 'connect' would never fire to reset it and no later connect_error would ever
  //    be allowed to try again.
  //  - on SUCCESS, left true until an actual 'connect' fires, so a connect_error that follows this
  //    specific manual attempt (e.g. the fresh token somehow still gets rejected) doesn't
  //    immediately fire off another refresh right on top of it.
  //  - on a DEFINITIVE failure, session-manager has already cleared storage and fired
  //    onSessionEnded (which disconnects this socket via auth-context's subscription), so clearing
  //    the flag here is harmless either way.
  // Combined with refreshSession()'s own single-flight, this bounds refresh attempts to one at a
  // time without ever permanently latching — recovery keeps being possible for as long as
  // Socket.io itself keeps trying, which by default is indefinitely, at its own backoff pace.
  let refreshAttemptInFlight = false;

  newSocket.on('connect', () => {
    refreshAttemptInFlight = false;
  });

  newSocket.on('connect_error', (err: SocketAuthConnectError) => {
    const code = err.data?.code;

    if (code !== 'ACCESS_TOKEN_EXPIRED') {
      // Anything else (missing token, malformed/tampered token, a plain network failure) is not
      // something a refresh can fix — never trigger one for an arbitrary auth failure.
      console.warn('[realtime] connect_error:', err.message);
      return;
    }

    if (refreshAttemptInFlight) {
      // A refresh triggered by this same expiry is already in flight (or we're waiting to see
      // whether the connect() we just fired after one succeeded actually lands) — don't pile on
      // another attempt on top of it.
      return;
    }
    refreshAttemptInFlight = true;

    refreshSession()
      .then(() => {
        // Same socket instance — never create a new one here. This just asks the existing
        // Manager to attempt a connection now rather than waiting for its next scheduled
        // automatic retry; the `auth` callback above re-reads the token fresh, so it picks up
        // what refreshSession() just stored.
        newSocket.connect();
      })
      .catch(() => {
        // Transient failure: preserve the ability to try again on the next connect_error rather
        // than stranding this socket with a permanently-latched flag. Definitive failure:
        // session-manager already handled ending the session; clearing this is harmless.
        refreshAttemptInFlight = false;
      });
  });

  return newSocket;
}

export function disconnectRealtime() {
  socket?.disconnect();
  socket = null;
}

export function getRealtimeSocket(): Socket | null {
  return socket;
}
