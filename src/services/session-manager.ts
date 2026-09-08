import { secureStorage } from '@/services/secure-storage';
import { fetchWithTimeout } from '@/utils/fetch-with-timeout';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
const ACCESS_TOKEN_KEY = 'buildflow.accessToken';
const REFRESH_TOKEN_KEY = 'buildflow.refreshToken';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Decodes a JWT's payload WITHOUT verifying its signature. The server verifies every real
 * request's token on every call — this exists solely for local, best-effort timing/UI decisions
 * (routing the UI before the first authenticated call, deciding whether a foreground refresh is
 * worth attempting). NEVER treat the result as trusted authorization information.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/**
 * Thrown when /auth/refresh gives a definitive "this session is over" answer (the server
 * responded, and it said no — invalid/expired/reused/revoked refresh token, disabled or deleted
 * account, or an invalidated session). Distinct from a plain network/timeout/offline failure,
 * which throws a plain Error and leaves stored tokens untouched so a later retry can still work.
 */
export class SessionEndedError extends Error {
  constructor(message = 'Session ended: refresh token is no longer valid') {
    super(message);
    this.name = 'SessionEndedError';
  }
}

type SessionEndedListener = () => void;
const sessionEndedListeners = new Set<SessionEndedListener>();

/** auth-context.tsx (or any future subscriber) registers here to learn when a refresh attempt has
 * conclusively ended the session, without session-manager needing to know anything about it —
 * this file must never import auth-context.tsx. Returns an unsubscribe function. */
export function onSessionEnded(listener: SessionEndedListener): () => void {
  sessionEndedListeners.add(listener);
  return () => sessionEndedListeners.delete(listener);
}

function emitSessionEnded() {
  for (const listener of sessionEndedListeners) listener();
}

export function getAccessToken(): Promise<string | null> {
  return secureStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): Promise<string | null> {
  return secureStorage.getItem(REFRESH_TOKEN_KEY);
}

/**
 * Persists a new token pair. The refresh token is written first, deliberately: if the app is
 * killed between these two writes, storage is left holding the new (already-rotated-to) refresh
 * token rather than the old one the server has since revoked — the safer of the two possible
 * half-written states.
 */
export async function setSession(tokens: SessionTokens): Promise<void> {
  await secureStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
  await secureStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
}

export async function clearSession(): Promise<void> {
  await secureStorage.deleteItem(ACCESS_TOKEN_KEY);
  await secureStorage.deleteItem(REFRESH_TOKEN_KEY);
}

let inFlightRefresh: Promise<SessionTokens> | null = null;

/**
 * Single-flight session refresh: no matter how many callers invoke this concurrently (multiple
 * REST requests hitting 401 at once, a socket reconnect attempt, a foreground check), only one
 * real POST /auth/refresh is ever in flight at a time — every caller shares and awaits the same
 * promise, and sees the same eventual resolution or rejection.
 *
 * Deliberately calls fetchWithTimeout() directly rather than going through api-client.ts's
 * request(): request()'s 401-retry interceptor must never be able to intercept *this* call, or a
 * rejected refresh could recursively trigger another refresh attempt (and another, and another).
 */
export function refreshSession(): Promise<SessionTokens> {
  if (!inFlightRefresh) {
    inFlightRefresh = performRefresh().finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

async function performRefresh(): Promise<SessionTokens> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) {
    // Nothing to refresh — not a session that just died, simply one that was never there this
    // launch. No clearSession()/emitSessionEnded(): there is nothing to clear or announce.
    throw new SessionEndedError('No refresh token is stored');
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(API_BASE_URL + '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch (networkError) {
    // Never touch stored tokens and never emit session-ended for a transient failure — offline,
    // DNS hiccup, request timeout, server unreachable. The caller can safely try again later with
    // whatever refresh token is still sitting in storage.
    throw networkError instanceof Error ? networkError : new Error('Network error during session refresh');
  }

  if (response.status === 401) {
    // The server itself said this refresh token is no longer valid — invalid, expired, reused,
    // revoked, or the account is disabled/deleted/invalidated. This is the one definitive case:
    // clear storage and tell every subscriber exactly once.
    await clearSession();
    emitSessionEnded();
    throw new SessionEndedError();
  }

  if (!response.ok) {
    // Anything else (429 rate-limited, 5xx) is treated the same as a network failure: transient,
    // not a verdict on the session itself. Storage is left untouched.
    throw new Error('Session refresh failed with status ' + response.status);
  }

  const body = (await response.json()) as SessionTokens;
  await setSession(body);
  return body;
}

/**
 * How close to its actual expiry an access token needs to be before a foreground check bothers
 * refreshing proactively. Access tokens live 15 minutes; a foreground event can land at any random
 * point in that window. 90 seconds is comfortably longer than any realistic refresh round-trip
 * (so the refresh reliably finishes before the old token would have actually expired), while still
 * being short enough that the overwhelming majority of foreground events — which land nowhere near
 * the end of a token's life — skip refreshing entirely rather than needlessly rotating the
 * refresh-token chain on every app open.
 */
const FOREGROUND_REFRESH_WINDOW_MS = 90 * 1000;

function isAccessTokenNearExpiry(accessToken: string): boolean {
  const payload = decodeJwtPayload(accessToken);
  const exp = typeof payload?.exp === 'number' ? payload.exp : null;
  if (exp === null) {
    // Undecodable — err on the side of refreshing rather than silently never doing so; a
    // definitive failure here is handled exactly like any other (see performRefresh above).
    return true;
  }
  return exp * 1000 - Date.now() <= FOREGROUND_REFRESH_WINDOW_MS;
}

/**
 * Called on every app-foreground transition (see auth-context.tsx's AppState listener). A cheap,
 * purely local check the overwhelming majority of the time — it only reaches the network when the
 * stored access token is missing, undecodable, or within FOREGROUND_REFRESH_WINDOW_MS of expiring.
 * Shares the exact same single-flight refreshSession() used by REST 401s and socket reconnects, so
 * a foreground check racing either of those collapses into the one already-in-flight request
 * rather than starting a second one.
 */
export async function refreshIfNeeded(): Promise<void> {
  const accessToken = await getAccessToken();
  if (!accessToken || isAccessTokenNearExpiry(accessToken)) {
    await refreshSession();
  }
}

/**
 * Full logout: local credentials are cleared first and unconditionally, so the user is logged out
 * from this device's perspective the instant this resolves, regardless of what happens next.
 * Server-side revocation of the refresh token is then attempted best-effort and never awaited by
 * the caller in a way that could block or fail the local logout — offline, a slow network, or a
 * server error must never prevent (or even delay) the user from being logged out here.
 *
 * Deliberately calls fetchWithTimeout() directly rather than going through api-client.ts's
 * request(): logout must still work when the access token has already expired, and must never be
 * routed through the 401-retry interceptor (there is nothing to refresh-and-retry for a logout
 * call).
 */
export async function logout(): Promise<void> {
  const refreshToken = await getRefreshToken();
  await clearSession();

  if (refreshToken) {
    revokeOnServer(refreshToken).catch(() => {
      // Best-effort only. Never logged (would risk echoing the token into logs) and never
      // surfaced — from the user's perspective, logout already succeeded above.
    });
  }
}

async function revokeOnServer(refreshToken: string): Promise<void> {
  await fetchWithTimeout(API_BASE_URL + '/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
}
