import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  logout,
  onSessionEnded,
  refreshIfNeeded,
  refreshSession,
  setSession,
  SessionEndedError,
} from '@/services/session-manager';

/** Builds a JWT-*shaped* string with a controllable `exp` claim — no signature verification ever
 * happens client-side (the real server does that on every request), so a fake, unsigned token is
 * all `decodeJwtPayload`'s base64url-decode-and-parse needs to be exercised realistically. */
function fakeJwt(payload: Record<string, unknown>): string {
  const base64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(payload)}.fake-signature`;
}

function accessTokenExpiringInSeconds(seconds: number): string {
  return fakeJwt({ sub: 'user-1', role: 'contractor', exp: Math.floor(Date.now() / 1000) + seconds });
}

const originalFetch = globalThis.fetch;

function mockFetchOnce(handler: () => Promise<Response> | Response) {
  let calls = 0;
  globalThis.fetch = (async (..._args: unknown[]) => {
    calls++;
    return handler();
  }) as typeof fetch;
  return () => calls;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function mockFetchCapture(handler: () => Promise<Response> | Response) {
  const calls: CapturedCall[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handler();
  }) as typeof fetch;
  return calls;
}

beforeEach(async () => {
  await clearSession();
  globalThis.fetch = originalFetch;
});

describe('single-flight refreshSession()', () => {
  test('three concurrent callers share exactly one network request', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });

    let resolveResponse!: (r: Response) => void;
    const responsePromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const getCallCount = mockFetchOnce(() => responsePromise);

    const callA = refreshSession();
    const callB = refreshSession();
    const callC = refreshSession();

    // Let the microtask queue settle so all three calls have had the chance to (mis)fire their
    // own fetch if the single-flight guard were broken, before we let the one real call resolve.
    await Promise.resolve();
    await Promise.resolve();

    resolveResponse(jsonResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh' }));

    const [a, b, c] = await Promise.all([callA, callB, callC]);

    assert.equal(getCallCount(), 1, 'expected exactly one underlying fetch call');
    assert.deepEqual(a, { accessToken: 'new-access', refreshToken: 'new-refresh' });
    assert.deepEqual(b, a);
    assert.deepEqual(c, a);

    assert.equal(await getAccessToken(), 'new-access');
    assert.equal(await getRefreshToken(), 'new-refresh');
  });

  test('a later, non-concurrent call performs a fresh network request', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });

    const getFirstCallCount = mockFetchOnce(() =>
      jsonResponse(200, { accessToken: 'access-1', refreshToken: 'refresh-1' }),
    );
    const first = await refreshSession();
    assert.equal(getFirstCallCount(), 1);
    assert.equal(first.accessToken, 'access-1');

    const getSecondCallCount = mockFetchOnce(() =>
      jsonResponse(200, { accessToken: 'access-2', refreshToken: 'refresh-2' }),
    );
    const second = await refreshSession();
    assert.equal(getSecondCallCount(), 1, 'the single-flight lock must release after completion');
    assert.equal(second.accessToken, 'access-2');
  });

  test('a host that never responds eventually rejects instead of hanging the app on the splash screen forever', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });

    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      // Simulates a hung connection, same as api-client.test.ts's equivalent case — this is the
      // exact failure mode that used to leave app bootstrap's `await refreshSession()` (and
      // therefore the splash screen) stuck forever whenever the backend was unreachable at launch.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    }) as typeof fetch;

    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const pending = assert.rejects(() => refreshSession(), (err: unknown) => {
        assert.equal((err as Error).name, 'AbortError');
        return true;
      });
      await new Promise((resolve) => setImmediate(resolve));
      mock.timers.tick(15000);
      await pending;
    } finally {
      mock.timers.reset();
    }
  });
});

describe('session-ended behavior', () => {
  test('a definitive 401 clears storage and notifies subscribers exactly once', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });
    mockFetchOnce(() => jsonResponse(401, { error: 'Invalid or expired refresh token', code: 'REFRESH_TOKEN_INVALID' }));

    let firedCount = 0;
    const unsubscribe = onSessionEnded(() => {
      firedCount++;
    });

    try {
      await assert.rejects(() => refreshSession(), SessionEndedError);
    } finally {
      unsubscribe();
    }

    assert.equal(firedCount, 1);
    assert.equal(await getAccessToken(), null, 'access token must be cleared on a definitive failure');
    assert.equal(await getRefreshToken(), null, 'refresh token must be cleared on a definitive failure');
  });

  test('concurrent callers sharing a rejected refresh only trigger one session-ended notification', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });

    let resolveResponse!: (r: Response) => void;
    const responsePromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    mockFetchOnce(() => responsePromise);

    let firedCount = 0;
    const unsubscribe = onSessionEnded(() => {
      firedCount++;
    });

    const callA = refreshSession().catch((err: unknown) => err);
    const callB = refreshSession().catch((err: unknown) => err);

    await Promise.resolve();
    resolveResponse(jsonResponse(401, { error: 'Refresh token has already been used', code: 'REFRESH_TOKEN_REUSED' }));

    const [errA, errB] = await Promise.all([callA, callB]);
    unsubscribe();

    assert.ok(errA instanceof SessionEndedError);
    assert.ok(errB instanceof SessionEndedError);
    assert.equal(firedCount, 1, 'the shared rejection must only end the session once, not once per awaiter');
  });

  test('a network failure does NOT end the session and leaves stored tokens untouched', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;

    let firedCount = 0;
    const unsubscribe = onSessionEnded(() => {
      firedCount++;
    });

    try {
      await assert.rejects(() => refreshSession());
    } finally {
      unsubscribe();
    }

    assert.equal(firedCount, 0, 'a network failure must never fire session-ended');
    assert.equal(await getAccessToken(), 'old-access', 'a network failure must never clear the access token');
    assert.equal(await getRefreshToken(), 'old-refresh', 'a network failure must never clear the refresh token');
  });

  test('a rejected refresh due to a network failure does not throw SessionEndedError', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;

    await assert.rejects(() => refreshSession(), (err: unknown) => {
      assert.ok(!(err instanceof SessionEndedError), 'a network failure must not be reported as SessionEndedError');
      return true;
    });
  });

  test('a non-2xx, non-401 response (e.g. rate limited) does not end the session', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });
    mockFetchOnce(() => jsonResponse(429, { error: 'Too many requests' }));

    let firedCount = 0;
    const unsubscribe = onSessionEnded(() => {
      firedCount++;
    });

    try {
      await assert.rejects(() => refreshSession());
    } finally {
      unsubscribe();
    }

    assert.equal(firedCount, 0);
    assert.equal(await getAccessToken(), 'old-access');
    assert.equal(await getRefreshToken(), 'old-refresh');
  });

  test('refreshing with no stored refresh token rejects without touching storage or firing session-ended', async () => {
    let firedCount = 0;
    const unsubscribe = onSessionEnded(() => {
      firedCount++;
    });

    try {
      await assert.rejects(() => refreshSession(), SessionEndedError);
    } finally {
      unsubscribe();
    }

    assert.equal(firedCount, 0, 'there was no session to end in the first place');
  });
});

describe('logout()', () => {
  test('calls server-side revocation with the current refresh token, then resolves', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });
    const calls = mockFetchCapture(() => jsonResponse(204, null));

    await logout();
    // The revocation call is fire-and-forget relative to logout()'s own resolution — give its
    // microtask a moment to actually run before asserting on it.
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/auth\/logout$/);
    const sentBody = JSON.parse(calls[0].init.body as string);
    assert.equal(sentBody.refreshToken, 'old-refresh');

    assert.equal(await getAccessToken(), null);
    assert.equal(await getRefreshToken(), null);
  });

  test('still clears local session when server logout fails (offline/5xx)', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;

    await assert.doesNotReject(() => logout());

    assert.equal(await getAccessToken(), null, 'local logout must succeed even if the server call fails');
    assert.equal(await getRefreshToken(), null, 'local logout must succeed even if the server call fails');
  });

  test('is a no-op toward the server when there was no refresh token to begin with', async () => {
    const calls = mockFetchCapture(() => jsonResponse(204, null));

    await assert.doesNotReject(() => logout());
    await Promise.resolve();

    assert.equal(calls.length, 0);
  });
});

describe('refreshIfNeeded() — foreground refresh check', () => {
  test('a healthy (far from expiry) token triggers no refresh at all', async () => {
    const healthyToken = accessTokenExpiringInSeconds(600);
    await setSession({ accessToken: healthyToken, refreshToken: 'old-refresh' });
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls++;
      throw new Error('should never be called');
    }) as typeof fetch;

    await refreshIfNeeded();

    assert.equal(fetchCalls, 0, 'a token with 10 minutes left must not trigger a network call');
    assert.equal(await getAccessToken(), healthyToken, 'the stored token must be left untouched');
  });

  test('a nearly-expired token triggers exactly one refresh', async () => {
    await setSession({ accessToken: accessTokenExpiringInSeconds(30), refreshToken: 'old-refresh' });
    const getCallCount = mockFetchOnce(() => jsonResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh' }));

    await refreshIfNeeded();

    assert.equal(getCallCount(), 1, 'a token 30 seconds from expiry is within the refresh window');
    assert.equal(await getAccessToken(), 'new-access');
  });

  test('an already-expired token also triggers a refresh', async () => {
    await setSession({ accessToken: accessTokenExpiringInSeconds(-10), refreshToken: 'old-refresh' });
    const getCallCount = mockFetchOnce(() => jsonResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh' }));

    await refreshIfNeeded();

    assert.equal(getCallCount(), 1);
  });

  test('multiple simultaneous foreground checks share exactly one refresh request', async () => {
    await setSession({ accessToken: accessTokenExpiringInSeconds(10), refreshToken: 'old-refresh' });

    let resolveResponse!: (r: Response) => void;
    const responsePromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const getCallCount = mockFetchOnce(() => responsePromise);

    const first = refreshIfNeeded();
    const second = refreshIfNeeded();
    const third = refreshIfNeeded();

    await Promise.resolve();
    await Promise.resolve();
    resolveResponse(jsonResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh' }));
    await Promise.all([first, second, third]);

    assert.equal(getCallCount(), 1, 'three near-simultaneous foreground events must share one refresh call');
  });

  test('a network failure during a foreground refresh preserves the session', async () => {
    const nearExpiry = accessTokenExpiringInSeconds(10);
    await setSession({ accessToken: nearExpiry, refreshToken: 'old-refresh' });
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;

    let sessionEndedFired = false;
    const unsubscribe = onSessionEnded(() => {
      sessionEndedFired = true;
    });

    try {
      await assert.rejects(() => refreshIfNeeded());
    } finally {
      unsubscribe();
    }

    assert.equal(sessionEndedFired, false, 'a transient foreground refresh failure must never end the session');
    assert.equal(await getAccessToken(), nearExpiry, 'the old token must remain in storage for the existing recovery paths to use');
  });

  test('a definitive foreground refresh failure ends the session exactly once', async () => {
    await setSession({ accessToken: accessTokenExpiringInSeconds(10), refreshToken: 'old-refresh' });
    mockFetchOnce(() => jsonResponse(401, { error: 'Refresh token has already been used', code: 'REFRESH_TOKEN_REUSED' }));

    let sessionEndedFired = 0;
    const unsubscribe = onSessionEnded(() => {
      sessionEndedFired++;
    });

    try {
      await assert.rejects(() => refreshIfNeeded(), SessionEndedError);
    } finally {
      unsubscribe();
    }

    assert.equal(sessionEndedFired, 1, 'a definitive failure must end the session exactly once');
    assert.equal(await getAccessToken(), null);
  });

  test('an undecodable access token errs on the side of refreshing', async () => {
    await setSession({ accessToken: 'not-a-real-jwt', refreshToken: 'old-refresh' });
    const getCallCount = mockFetchOnce(() => jsonResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh' }));

    await refreshIfNeeded();

    assert.equal(getCallCount(), 1);
  });
});
