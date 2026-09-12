import { describe, it, expect, afterEach } from 'vitest';
import type { Envelope } from '@sentry/core';
import { initSentry, captureError, flushSentry, isSentryInitialized, resetSentryForTests, scrubEvent } from '../observability/sentry';

// Deliberately no `vi.mock('@sentry/node')` and no `vi.spyOn(Sentry, ...)` anywhere in this file —
// @sentry/node's exports are non-configurable (spying on them throws "Cannot redefine property"),
// and mocking the module would defeat the entire point here: proving the REAL
// init → captureException → beforeSend → transport pipeline behaves correctly, not a stand-in for
// it. Defensive-wrapper failure-injection tests (a mocked Sentry SDK call throwing) live in the
// separate sentry-safety.test.ts, which uses vi.mock precisely because those tests need Sentry's
// functions replaced, not observed.

/**
 * Verifies the real Sentry pipeline end-to-end (init → captureException → beforeSend redaction →
 * transport) using a fake in-memory transport (Sentry's own supported extension point — see
 * @sentry/core's Transport interface) instead of merely asserting the SDK module imports without
 * throwing. No network call is ever made by this file.
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

/** Pulls the first event item's JSON body out of a captured envelope — envelopes are
 * [header, items[]] tuples where each item is itself an [itemHeader, payload] tuple. */
function firstEventPayload(envelope: Envelope): any {
  const items = envelope[1];
  for (const [, payload] of items) {
    if (payload && typeof payload === 'object') return payload;
  }
  return undefined;
}

describe('Sentry observability integration (Phase 3.9)', () => {
  afterEach(() => {
    resetSentryForTests();
  });

  it('does not initialize, and captureError/flushSentry no-op safely, when no DSN is provided', async () => {
    initSentry({ dsn: undefined });
    expect(isSentryInitialized()).toBe(false);

    expect(() => captureError(new Error('should be a no-op'))).not.toThrow();
    await expect(flushSentry()).resolves.toBeUndefined();
  });

  it('sends a real controlled test event through init → captureException → beforeSend → transport', async () => {
    const { envelopes, factory } = createFakeTransport();
    initSentry({ dsn: 'https://fakepublickey@fake.ingest.sentry.io/1234567', transport: factory });
    expect(isSentryInitialized()).toBe(true);

    captureError(new Error('Phase 3.9 controlled test event'), {
      tags: { requestId: 'test-request-id-123', path: '/test/path', method: 'GET' },
    });
    await flushSentry();

    expect(envelopes.length).toBeGreaterThanOrEqual(1);
    const payload = firstEventPayload(envelopes[0]);
    expect(payload).toBeDefined();
    expect(JSON.stringify(payload)).toContain('Phase 3.9 controlled test event');
    expect(payload.tags).toMatchObject({ requestId: 'test-request-id-123', path: '/test/path', method: 'GET' });
  });

  it('redacts sensitive tag values through the real beforeSend pipeline, not just structurally-safe fields', async () => {
    const { envelopes, factory } = createFakeTransport();
    initSentry({ dsn: 'https://fakepublickey@fake.ingest.sentry.io/1234567', transport: factory });

    captureError(new Error('event with sensitive tags'), {
      tags: {
        requestId: 'keep-me-123',
        password: 'super-secret-password',
        authorization: 'Bearer abcdefghijklmnop',
        refreshToken: 'a-real-looking-refresh-token-value',
      },
    });
    await flushSentry();

    const payload = firstEventPayload(envelopes[envelopes.length - 1]);
    const serialized = JSON.stringify(payload);
    expect(payload.tags.requestId).toBe('keep-me-123');
    expect(payload.tags.password).toBe('[REDACTED]');
    expect(payload.tags.authorization).toBe('[REDACTED]');
    // Truncated, not fully removed — matches logger.ts's truncateSecret contract for token-shaped
    // keys (enough survives to correlate, never the full secret).
    expect(payload.tags.refreshToken).not.toBe('a-real-looking-refresh-token-value');
    expect(payload.tags.refreshToken).toMatch(/^a-real…/);
    expect(serialized).not.toContain('super-secret-password');
    expect(serialized).not.toContain('a-real-looking-refresh-token-value');
  });

  it('scrubEvent structurally strips request/user/breadcrumbs and redacts extra/contexts, even if a future integration ever populated them', () => {
    const fakeEvent: any = {
      request: { headers: { authorization: 'Bearer should-never-survive' }, cookies: { session: 'abc' } },
      user: { phone: '+91 90000 00001', ip_address: '1.2.3.4' },
      breadcrumbs: [{ message: 'GET /orders/123' }],
      extra: { password: 'p@ss', note: 'safe value', apiKey: 'sk-live-should-not-survive' },
      tags: { secretToken: 'jwt-shaped-value-1234567890' },
      contexts: { custom: { cookie: 'nom-nom', harmless: 'ok' } },
    };

    const scrubbed = scrubEvent(fakeEvent);

    expect(scrubbed.request).toBeUndefined();
    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.breadcrumbs).toBeUndefined();
    expect((scrubbed.extra as any).password).toBe('[REDACTED]');
    expect((scrubbed.extra as any).apiKey).toBe('[REDACTED]');
    expect((scrubbed.extra as any).note).toBe('safe value');
    expect((scrubbed.tags as any).secretToken).not.toBe('jwt-shaped-value-1234567890');
    expect((scrubbed.contexts as any).custom.cookie).toBe('[REDACTED]');
    expect((scrubbed.contexts as any).custom.harmless).toBe('ok');
  });
});
