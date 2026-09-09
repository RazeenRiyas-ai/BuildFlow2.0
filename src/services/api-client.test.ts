import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { apiClient, ApiError } from '@/services/api-client';
import { clearSession, getAccessToken, onSessionEnded, setSession } from '@/services/session-manager';

const originalFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function expiredTokenResponse(): Response {
  return jsonResponse(401, { error: 'Access token has expired', code: 'ACCESS_TOKEN_EXPIRED' });
}

interface CapturedCall {
  path: string;
  authorization: string | undefined;
}

/** Routes the mocked global fetch by path suffix (`/orders`, `/auth/refresh`, ...) to a queue of
 * handlers — each call to a given path consumes the next handler queued for it, so a test can
 * script "first call returns 401, second call returns 200" for the same endpoint. */
function installFetchRouter(routes: Record<string, (() => Promise<Response> | Response)[]>) {
  const calls: CapturedCall[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const path = '/' + url.split('/').slice(3).join('/');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ path, authorization: headers.Authorization });

    const handler = routes[path]?.shift();
    if (!handler) {
      throw new Error('Unexpected fetch to ' + path);
    }
    return handler();
  }) as typeof fetch;
  return calls;
}

beforeEach(async () => {
  await clearSession();
  globalThis.fetch = originalFetch;
});

describe('api-client 401 → refresh → retry', () => {
  test('an expired access token triggers a refresh and the original request then succeeds', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });

    const calls = installFetchRouter({
      '/orders': [expiredTokenResponse, () => jsonResponse(200, [{ id: 'order-1' }])],
      '/auth/refresh': [() => jsonResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh' })],
    });

    const result = await apiClient.get<{ id: string }[]>('/orders');

    assert.deepEqual(result, [{ id: 'order-1' }]);
    assert.equal(await getAccessToken(), 'new-access');

    const orderCalls = calls.filter((c) => c.path === '/orders');
    assert.equal(orderCalls.length, 2, 'expected the original call plus exactly one retry');
    assert.equal(orderCalls[0].authorization, 'Bearer old-access');
    assert.equal(orderCalls[1].authorization, 'Bearer new-access', 'the retry must use the refreshed token');
  });

  test('multiple simultaneous 401s share exactly one refresh request', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });

    const calls = installFetchRouter({
      '/orders': [expiredTokenResponse, () => jsonResponse(200, { id: 'order-1' })],
      '/sites': [expiredTokenResponse, () => jsonResponse(200, { id: 'site-1' })],
      '/contractors/me': [expiredTokenResponse, () => jsonResponse(200, { id: 'contractor-1' })],
      '/auth/refresh': [() => jsonResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh' })],
    });

    const [orders, sites, contractor] = await Promise.all([
      apiClient.get('/orders'),
      apiClient.get('/sites'),
      apiClient.get('/contractors/me'),
    ]);

    assert.deepEqual(orders, { id: 'order-1' });
    assert.deepEqual(sites, { id: 'site-1' });
    assert.deepEqual(contractor, { id: 'contractor-1' });

    const refreshCalls = calls.filter((c) => c.path === '/auth/refresh');
    assert.equal(refreshCalls.length, 1, 'three concurrent 401s must trigger exactly one refresh call');
  });

  test('a 401 for a malformed/invalid (not expired) token is never retried', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });

    const calls = installFetchRouter({
      '/orders': [() => jsonResponse(401, { error: 'Invalid access token', code: 'ACCESS_TOKEN_INVALID' })],
      '/auth/refresh': [() => jsonResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh' })],
    });

    await assert.rejects(() => apiClient.get('/orders'), (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 401);
      assert.equal(err.code, 'ACCESS_TOKEN_INVALID');
      return true;
    });

    assert.equal(calls.filter((c) => c.path === '/orders').length, 1, 'no retry should have been attempted');
    assert.equal(calls.filter((c) => c.path === '/auth/refresh').length, 0, 'refresh must never be triggered');
  });

  test('a 401 with no code at all is never retried', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });

    const calls = installFetchRouter({
      '/orders': [() => jsonResponse(401, { error: 'Unauthorized' })],
    });

    await assert.rejects(() => apiClient.get('/orders'), ApiError);
    assert.equal(calls.filter((c) => c.path === '/auth/refresh').length, 0);
  });

  test('the retry itself is never retried, even if it also comes back 401 ACCESS_TOKEN_EXPIRED', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });

    const calls = installFetchRouter({
      '/orders': [expiredTokenResponse, expiredTokenResponse],
      '/auth/refresh': [() => jsonResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh' })],
    });

    await assert.rejects(() => apiClient.get('/orders'), (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 401);
      return true;
    });

    assert.equal(calls.filter((c) => c.path === '/orders').length, 2, 'exactly one retry, not more');
    assert.equal(calls.filter((c) => c.path === '/auth/refresh').length, 1, 'refresh must not be attempted again');
  });

  test('request bodies survive the retry unchanged', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });

    const sentBodies: string[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const path = '/' + url.split('/').slice(3).join('/');
      if (path === '/orders') {
        sentBodies.push(init?.body as string);
        if (sentBodies.length === 1) {
          return expiredTokenResponse();
        }
        return jsonResponse(201, { id: 'new-order' });
      }
      if (path === '/auth/refresh') {
        return jsonResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh' });
      }
      throw new Error('Unexpected fetch to ' + path);
    }) as typeof fetch;

    const result = await apiClient.post('/orders', { materialId: 'm1', quantity: 5 });

    assert.deepEqual(result, { id: 'new-order' });
    assert.equal(sentBodies.length, 2);
    assert.deepEqual(JSON.parse(sentBodies[0]), { materialId: 'm1', quantity: 5 });
    assert.deepEqual(JSON.parse(sentBodies[1]), JSON.parse(sentBodies[0]), 'retry must send the identical body');
  });

  test('an explicit Idempotency-Key header survives the retry unchanged, and is absent when not passed', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });

    const sentHeaders: (Record<string, string> | undefined)[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const path = '/' + url.split('/').slice(3).join('/');
      if (path === '/orders') {
        sentHeaders.push(init?.headers as Record<string, string> | undefined);
        if (sentHeaders.length === 1) {
          return expiredTokenResponse();
        }
        return jsonResponse(201, { id: 'new-order' });
      }
      if (path === '/auth/refresh') {
        return jsonResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh' });
      }
      throw new Error('Unexpected fetch to ' + path);
    }) as typeof fetch;

    await apiClient.post('/orders', { materialId: 'm1' }, { headers: { 'Idempotency-Key': 'order-abc-123' } });

    assert.equal(sentHeaders.length, 2);
    assert.equal(sentHeaders[0]?.['Idempotency-Key'], 'order-abc-123');
    assert.equal(sentHeaders[1]?.['Idempotency-Key'], 'order-abc-123', 'the retry must reuse the exact same key, not a new one');
  });

  test('apiClient.post sends no Idempotency-Key header at all when the caller does not opt in', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });

    let sentHeaders: Record<string, string> | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sentHeaders = init?.headers as Record<string, string> | undefined;
      return jsonResponse(201, { id: 'new-order' });
    }) as typeof fetch;

    await apiClient.post('/orders', { materialId: 'm1' });

    assert.equal(sentHeaders?.['Idempotency-Key'], undefined);
  });
});

describe('api-client.upload (multipart)', () => {
  test('sends the FormData body as-is with no Content-Type header, letting fetch set the multipart boundary', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });

    let capturedBody: unknown;
    let capturedHeaders: Record<string, string> | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body;
      capturedHeaders = init?.headers as Record<string, string> | undefined;
      return jsonResponse(201, { id: 'photo-1' });
    }) as typeof fetch;

    const formData = new FormData();
    formData.append('photo', 'fake-file-content');

    const result = await apiClient.upload<{ id: string }>('/hq/materials/m1/photos', formData);

    assert.deepEqual(result, { id: 'photo-1' });
    assert.ok(capturedBody instanceof FormData, 'body must be passed through as FormData, not JSON-stringified');
    assert.equal(capturedHeaders?.['Content-Type'], undefined, 'Content-Type must be left unset for a multipart body');
    assert.equal(capturedHeaders?.Authorization, 'Bearer old-access');
  });
});

describe('api-client request timeout', () => {
  test('a request to a host that never responds eventually rejects instead of hanging forever', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });

    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      // Simulates a hung connection: never resolves or rejects on its own, and only reacts to
      // the timeout's abort — exactly what a dead LAN IP or a silently dropped connection does.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    }) as typeof fetch;

    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const pending = assert.rejects(() => apiClient.get('/orders'), (err: unknown) => {
        assert.equal((err as Error).name, 'AbortError');
        return true;
      });
      // Let the pending getAccessToken() microtask resolve first — otherwise fetchWithTimeout's
      // setTimeout hasn't been scheduled yet when tick() runs, and the mocked clock never fires it.
      await new Promise((resolve) => setImmediate(resolve));
      mock.timers.tick(15000);
      await pending;
    } finally {
      mock.timers.reset();
    }
  });
});

describe('api-client + session-manager integration on refresh failure', () => {
  test('a network failure during refresh preserves the session and surfaces the original 401', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });

    globalThis.fetch = (async (url: string) => {
      const path = '/' + url.split('/').slice(3).join('/');
      if (path === '/orders') {
        return expiredTokenResponse();
      }
      if (path === '/auth/refresh') {
        throw new TypeError('fetch failed');
      }
      throw new Error('Unexpected fetch to ' + path);
    }) as typeof fetch;

    let sessionEndedFired = false;
    const unsubscribe = onSessionEnded(() => {
      sessionEndedFired = true;
    });

    try {
      await assert.rejects(() => apiClient.get('/orders'), (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 401);
        assert.equal(err.code, 'ACCESS_TOKEN_EXPIRED');
        return true;
      });
    } finally {
      unsubscribe();
    }

    assert.equal(sessionEndedFired, false, 'a network failure refreshing must never end the session');
    assert.equal(await getAccessToken(), 'old-access', 'tokens must survive a network failure during refresh');
  });

  test('a definitive refresh failure ends the session and surfaces the original 401', async () => {
    await setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });

    installFetchRouter({
      '/orders': [expiredTokenResponse],
      '/auth/refresh': [() => jsonResponse(401, { error: 'Refresh token has already been used', code: 'REFRESH_TOKEN_REUSED' })],
    });

    let sessionEndedFired = 0;
    const unsubscribe = onSessionEnded(() => {
      sessionEndedFired++;
    });

    try {
      await assert.rejects(() => apiClient.get('/orders'), (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 401);
        assert.equal(err.code, 'ACCESS_TOKEN_EXPIRED', 'the caller sees the ORIGINAL error, not the refresh failure');
        return true;
      });
    } finally {
      unsubscribe();
    }

    assert.equal(sessionEndedFired, 1, 'a definitive refresh failure must end the session exactly once');
    assert.equal(await getAccessToken(), null, 'storage must be cleared once the session ends');
  });
});
