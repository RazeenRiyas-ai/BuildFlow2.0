import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { connectRealtime, disconnectRealtime, getRealtimeSocket } from '@/services/realtime-client';
import { clearSession, getAccessToken, onSessionEnded, refreshSession, setSession } from '@/services/session-manager';
// scripts/test-alias-loader.mjs redirects realtime-client.ts's bare `'socket.io-client'` import to
// this exact file. Importing it here by its real relative path (rather than the bare specifier,
// which tsc would resolve against the real package's own types) reaches the identical cached
// module instance — Node's ESM cache keys by resolved URL, not the original specifier text — so
// `__getCreatedSockets()` here sees the same sockets realtime-client.ts created.
import { __getCreatedSockets, __resetSocketIoMock } from '../../scripts/test-mocks/socket-io-client.mjs';

const originalFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function expiredTokenError(): Error & { data: { code: string } } {
  return Object.assign(new Error('Unauthorized: access token has expired'), { data: { code: 'ACCESS_TOKEN_EXPIRED' } });
}

function invalidTokenError(): Error & { data: { code: string } } {
  return Object.assign(new Error('Unauthorized: invalid access token'), { data: { code: 'ACCESS_TOKEN_INVALID' } });
}

function countRefreshCalls(url: string): boolean {
  return url.endsWith('/auth/refresh');
}

/** Lets every already-scheduled microtask AND one macrotask turn run before continuing — enough
 * for a connect_error handler's `refreshSession().then(...)` chain (itself several awaits deep:
 * reading storage, fetching, parsing JSON, writing storage) to fully settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(async () => {
  disconnectRealtime();
  __resetSocketIoMock();
  await clearSession();
  globalThis.fetch = originalFetch;
});

describe('realtime-client reconnect-refresh coordination', () => {
  test('an expired socket token triggers a refresh, then reconnects the SAME socket instance', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });

    const refreshCalls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      if (countRefreshCalls(url)) {
        refreshCalls.push(url);
        return jsonResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh' });
      }
      throw new Error('Unexpected fetch to ' + url);
    }) as typeof fetch;

    connectRealtime();
    const socket = getRealtimeSocket() as unknown as { __trigger: (e: string, ...a: unknown[]) => void; connectCallCount: number };

    socket.__trigger('connect_error', expiredTokenError());
    await flush();
    await flush();

    assert.equal(refreshCalls.length, 1, 'expected exactly one refresh call');
    assert.equal(socket.connectCallCount, 1, 'expected the existing socket to be nudged to reconnect once');
    assert.equal(await getAccessToken(), 'new-access');
    assert.equal(__getCreatedSockets().length, 1, 'no replacement Socket instance should ever be created');
  });

  test('an invalid (non-expired) socket token never triggers a refresh', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });

    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls++;
      throw new Error('should never be called');
    }) as typeof fetch;

    connectRealtime();
    const socket = getRealtimeSocket() as unknown as { __trigger: (e: string, ...a: unknown[]) => void; connectCallCount: number };

    socket.__trigger('connect_error', invalidTokenError());
    await flush();

    assert.equal(fetchCalls, 0, 'refresh must never be attempted for a malformed/invalid token');
    assert.equal(socket.connectCallCount, 0);
  });

  test('two connect_error events in the same episode share exactly one refresh request', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });

    let refreshCalls = 0;
    let resolveRefresh!: (r: Response) => void;
    const refreshPromise = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    globalThis.fetch = (async (url: string) => {
      if (countRefreshCalls(url)) {
        refreshCalls++;
        return refreshPromise;
      }
      throw new Error('Unexpected fetch to ' + url);
    }) as typeof fetch;

    connectRealtime();
    const socket = getRealtimeSocket() as unknown as { __trigger: (e: string, ...a: unknown[]) => void; connectCallCount: number };

    socket.__trigger('connect_error', expiredTokenError());
    socket.__trigger('connect_error', expiredTokenError());
    await flush();

    resolveRefresh(jsonResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh' }));
    await flush();
    await flush();

    assert.equal(refreshCalls, 1, 'two connect_error events in one episode must share a single refresh call');
    assert.equal(socket.connectCallCount, 1, 'the reconnect nudge must also only happen once per episode');
  });

  test('a network failure refreshing preserves the session (no logout, no crash)', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });

    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;

    let sessionEndedFired = false;
    const unsubscribe = onSessionEnded(() => {
      sessionEndedFired = true;
    });

    connectRealtime();
    const socket = getRealtimeSocket() as unknown as { __trigger: (e: string, ...a: unknown[]) => void; connectCallCount: number };

    try {
      socket.__trigger('connect_error', expiredTokenError());
      await flush();
      await flush();
    } finally {
      unsubscribe();
    }

    assert.equal(sessionEndedFired, false, 'a network failure refreshing must never end the session');
    assert.equal(socket.connectCallCount, 0, 'no reconnect should be attempted without a successful refresh');
    assert.equal(await getAccessToken(), 'old-access', 'tokens must survive a network failure during refresh');
  });

  test('a definitive refresh failure ends the session exactly once', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });

    globalThis.fetch = (async (url: string) => {
      if (countRefreshCalls(url)) {
        return jsonResponse(401, { error: 'Refresh token has already been used', code: 'REFRESH_TOKEN_REUSED' });
      }
      throw new Error('Unexpected fetch to ' + url);
    }) as typeof fetch;

    let sessionEndedFired = 0;
    const unsubscribe = onSessionEnded(() => {
      sessionEndedFired++;
    });

    connectRealtime();
    const socket = getRealtimeSocket() as unknown as { __trigger: (e: string, ...a: unknown[]) => void; connectCallCount: number };

    try {
      socket.__trigger('connect_error', expiredTokenError());
      await flush();
      await flush();
    } finally {
      unsubscribe();
    }

    assert.equal(sessionEndedFired, 1, 'a definitive refresh failure must end the session exactly once');
    assert.equal(socket.connectCallCount, 0, 'no reconnect should be attempted after a definitive failure');
    assert.equal(await getAccessToken(), null);
  });

  test('recovers after a transient refresh failure: a later connect_error gets its own fresh refresh attempt', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });

    let refreshCalls = 0;
    globalThis.fetch = (async (url: string) => {
      if (!countRefreshCalls(url)) throw new Error('Unexpected fetch to ' + url);
      refreshCalls++;
      if (refreshCalls === 1) {
        throw new TypeError('fetch failed'); // transient: e.g. a brief network blip
      }
      return jsonResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh' });
    }) as typeof fetch;

    let sessionEndedFired = 0;
    const unsubscribe = onSessionEnded(() => {
      sessionEndedFired++;
    });

    connectRealtime();
    const socket = getRealtimeSocket() as unknown as {
      on: (e: string, h: (...a: unknown[]) => void) => void;
      __trigger: (e: string, ...a: unknown[]) => void;
      __listenerCount: (e: string) => number;
      connectCallCount: number;
    };

    // The exact useOrderRoom.ts pattern: rejoin whenever the socket (re)connects.
    let joinCount = 0;
    socket.on('connect', () => {
      joinCount++;
    });

    try {
      // First connect_error: refresh fails transiently. Must NOT strand the socket.
      socket.__trigger('connect_error', expiredTokenError());
      await flush();
      await flush();

      assert.equal(refreshCalls, 1, 'first refresh attempt should have been made');
      assert.equal(sessionEndedFired, 0, 'a transient failure must never end the session');
      assert.equal(await getAccessToken(), 'old-access', 'tokens must survive the transient failure');
      assert.equal(socket.connectCallCount, 0, 'no reconnect should be nudged after a failed refresh');

      // Time passes; Socket.io's own automatic reconnection fires another attempt with the same
      // still-expired token, producing a second connect_error — this must NOT be silently ignored
      // just because the first refresh attempt already happened and failed.
      socket.__trigger('connect_error', expiredTokenError());
      await flush();
      await flush();

      assert.equal(refreshCalls, 2, 'exactly two refresh attempts total: the failed one and the recovering one');
      assert.equal(socket.connectCallCount, 1, 'the second, successful refresh must nudge exactly one reconnect');
      assert.equal(await getAccessToken(), 'new-access', 'the second refresh must have stored the new tokens');

      // The nudge lands: the socket actually reconnects.
      socket.__trigger('connect');
    } finally {
      unsubscribe();
    }

    assert.equal(joinCount, 1, 'the order-room connect listener must fire once recovery completes');
    assert.equal(sessionEndedFired, 0, 'recovery must never have ended the session along the way');
    assert.equal(__getCreatedSockets().length, 1, 'the entire recovery must happen on the original socket instance');
    assert.equal(socket.__listenerCount('connect_error'), 1, 'no duplicate connect_error listeners after recovery');
    assert.equal(socket.__listenerCount('connect'), 2, 'exactly the two listeners registered: the internal guard reset and this test\'s join simulation — none duplicated');
  });

  test('a second, later episode still gets its own refresh (the per-episode guard resets on connect)', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });

    let refreshCalls = 0;
    globalThis.fetch = (async (url: string) => {
      if (countRefreshCalls(url)) {
        refreshCalls++;
        return jsonResponse(200, { accessToken: 'new-access-' + refreshCalls, refreshToken: 'new-refresh-' + refreshCalls });
      }
      throw new Error('Unexpected fetch to ' + url);
    }) as typeof fetch;

    connectRealtime();
    const socket = getRealtimeSocket() as unknown as {
      __trigger: (e: string, ...a: unknown[]) => void;
      connectCallCount: number;
    };

    // Episode 1: fails to authenticate, refresh succeeds, we nudge a reconnect.
    socket.__trigger('connect_error', expiredTokenError());
    await flush();
    await flush();
    assert.equal(refreshCalls, 1);
    assert.equal(socket.connectCallCount, 1);

    // The nudge succeeds and the socket actually connects — this is what resets the per-episode guard.
    socket.__trigger('connect');

    // Episode 2: token goes stale again later; this must trigger its own, independent refresh.
    socket.__trigger('connect_error', expiredTokenError());
    await flush();
    await flush();

    assert.equal(refreshCalls, 2, 'a new episode after a successful connect must refresh again');
    assert.equal(socket.connectCallCount, 2);
    assert.equal(__getCreatedSockets().length, 1, 'still the same single socket instance throughout');
  });
});

describe('order-room rejoin survives reconnects (same pattern useOrderRoom.ts uses)', () => {
  test('a listener registered via socket.on("connect", join) fires again on every reconnect, not just the first', async () => {
    connectRealtime();
    const socket = getRealtimeSocket() as unknown as {
      on: (e: string, h: (...a: unknown[]) => void) => void;
      __trigger: (e: string, ...a: unknown[]) => void;
      emit: (e: string, ...a: unknown[]) => void;
    };

    let joinCount = 0;
    // Exactly useOrderRoom.ts's own pattern: join() re-emits order:join on every 'connect'.
    const join = () => {
      joinCount++;
      socket.emit('order:join', { orderId: 'order-1' });
    };
    socket.on('connect', join);

    socket.__trigger('connect');
    socket.__trigger('connect');
    socket.__trigger('connect');

    assert.equal(joinCount, 3, 'the room must be rejoined on every successful (re)connection, not only the first');
  });

  test('repeated connectRealtime() calls never leave more than one socket instance or duplicate internal listeners', async () => {
    await setSession({ accessToken: 'a', refreshToken: 'r' });

    connectRealtime();
    const first = getRealtimeSocket() as unknown as { __listenerCount: (e: string) => number };
    assert.equal(first.__listenerCount('connect_error'), 1);
    assert.equal(first.__listenerCount('connect'), 1);

    // Simulate what auth-context does on a fresh login/register/cold-launch refresh — this is the
    // ONLY code path allowed to create a new instance, and it must fully replace the old one
    // rather than layering listeners onto it.
    connectRealtime();
    const second = getRealtimeSocket();

    assert.notEqual(first, second, 'connectRealtime() intentionally replaces the instance on a fresh login');
    assert.equal(__getCreatedSockets().length, 2, 'exactly one new instance per explicit connectRealtime() call, no more');
    const secondTyped = second as unknown as { __listenerCount: (e: string) => number };
    assert.equal(secondTyped.__listenerCount('connect_error'), 1, 'the new instance must not accumulate duplicate listeners');
    assert.equal(secondTyped.__listenerCount('connect'), 1);
  });
});

describe('foreground refresh (session-manager.refreshIfNeeded) never touches the socket instance', () => {
  test('a session-manager refresh completing while the socket is already connected creates no new Socket', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });

    globalThis.fetch = (async (url: string) => {
      if (url.endsWith('/auth/refresh')) {
        return jsonResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh' });
      }
      throw new Error('Unexpected fetch to ' + url);
    }) as typeof fetch;

    connectRealtime();
    const socket = getRealtimeSocket();
    assert.equal(__getCreatedSockets().length, 1);

    // This is exactly what auth-context's AppState foreground handler triggers via
    // session-manager.refreshIfNeeded() — session-manager has no knowledge of realtime-client at
    // all (see the dependency graph: session-manager imports nothing from either api-client or
    // realtime-client), so a foreground-triggered refresh structurally cannot call connectRealtime().
    await refreshSession();

    assert.equal(await getAccessToken(), 'new-access');
    assert.equal(__getCreatedSockets().length, 1, 'no new Socket instance was created by the refresh');
    assert.equal(getRealtimeSocket(), socket, 'the exact same socket object is still in use');
  });
});
