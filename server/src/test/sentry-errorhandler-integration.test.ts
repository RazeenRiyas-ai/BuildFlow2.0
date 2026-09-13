import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import type { Envelope } from '@sentry/core';
import { app } from '../app';
import { pool } from '../config/db';
import { initSentry, flushSentry, resetSentryForTests } from '../observability/sentry';

/**
 * Verifies the REAL production error path — a genuine HTTP request through the real Express app,
 * hitting a real controller/service, whose real database call really rejects, propagating through
 * the real asyncHandler -> errorHandler.ts middleware chain -> the real captureError() call site —
 * with Sentry genuinely initialized via a fake in-memory transport (no network call is made).
 *
 * This is deliberately NOT another unit test of observability/sentry.ts's own functions (see
 * sentry-observability.test.ts / sentry-safety.test.ts for those) and NOT the process-safety.ts
 * subprocess integration (see process-safety.test.ts) — this is the third, previously-missing
 * integration point: the HTTP-request-triggered 5xx path through errorHandler.ts specifically,
 * including the one thing only a real HTTP request can prove: that the requestId returned to the
 * actual client is the exact same requestId attached to the Sentry event.
 */
function createFakeTransport() {
  const envelopes: Envelope[] = [];
  return {
    envelopes,
    factory: () => ({
      send: async (envelope: Envelope) => {
        envelopes.push(envelope);
        return {};
      },
      flush: async () => true,
    }),
  };
}

function firstEventPayload(envelope: Envelope): any {
  const items = envelope[1];
  for (const [, payload] of items) {
    if (payload && typeof payload === 'object') return payload;
  }
  return undefined;
}

describe('Sentry capture through the real errorHandler.ts 5xx path (Phase 3.9 integration)', () => {
  afterEach(() => {
    resetSentryForTests();
    vi.restoreAllMocks();
  });

  it('a real 500 from a genuine HTTP request reaches Sentry, with requestId preserved and redaction/structural scrubbing still applied', async () => {
    const { envelopes, factory } = createFakeTransport();
    initSentry({ dsn: 'https://fakepublickey@fake.ingest.sentry.io/1234567', transport: factory });

    // Forces a real failure inside the real GET /categories -> categoriesController.list ->
    // categoriesService.listCategories() call chain — nothing about the route/controller/service
    // is mocked or bypassed, only the one query this specific endpoint issues.
    const originalQuery = pool.query.bind(pool);
    const spy = vi.spyOn(pool, 'query').mockImplementation(((text: unknown, ...rest: unknown[]) => {
      if (typeof text === 'string' && text.includes('FROM categories ORDER BY name')) {
        return Promise.reject(new Error('simulated real 5xx for Sentry integration test'));
      }
      return (originalQuery as (...a: unknown[]) => unknown)(text, ...rest);
    }) as typeof pool.query);

    try {
      const res = await request(app).get('/categories');

      // Confirms this really did go through errorHandler.ts's generic 500 branch, not some other
      // path — same response shape every other 500 in this app produces.
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('InternalServerError');
      expect(res.body.requestId).toBeTruthy();

      // errorHandler.ts's captureError() call is synchronous, but Sentry's own event pipeline is
      // not guaranteed to have handed the envelope to the transport by the time captureException()
      // returns — flushSentry() (the same function process-safety.ts relies on before exiting)
      // makes this deterministic instead of racing on a timing assumption.
      await flushSentry();

      expect(envelopes.length).toBeGreaterThanOrEqual(1);
      const payload = firstEventPayload(envelopes[0]);
      expect(payload).toBeDefined();
      expect(JSON.stringify(payload)).toContain('simulated real 5xx for Sentry integration test');

      // The exact property this integration test exists to prove: the requestId the real HTTP
      // client actually received is the same one attached to the Sentry event — not just "some
      // requestId", not verified in isolation from an actual request/response cycle.
      expect(payload.tags.requestId).toBe(res.body.requestId);
      expect(payload.tags.path).toBe('/categories');
      expect(payload.tags.method).toBe('GET');

      // Redaction/structural scrubbing (beforeSend's scrubEvent) still applies on this real,
      // HTTP-triggered path — not only in the direct-call tests in sentry-observability.test.ts.
      expect(payload.request).toBeUndefined();
      expect(payload.user).toBeUndefined();
      expect(payload.breadcrumbs).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it('does not capture anything when the same request succeeds normally', async () => {
    const { envelopes, factory } = createFakeTransport();
    initSentry({ dsn: 'https://fakepublickey@fake.ingest.sentry.io/1234567', transport: factory });

    const res = await request(app).get('/categories');
    expect(res.status).toBe(200);

    await flushSentry();
    expect(envelopes.length).toBe(0);
  });
});
