import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Verifies observability/sentry.ts's defensive try/catch wrappers when the underlying Sentry SDK
 * itself throws — separate from sentry-observability.test.ts (which verifies the real pipeline and
 * deliberately never mocks @sentry/node). @sentry/node's exports are non-configurable, so
 * `vi.spyOn(Sentry, 'x')` throws "Cannot redefine property" — `vi.mock` intercepts at module
 * resolution instead, which works regardless of the real module's property descriptors.
 *
 * Each test does its own `vi.resetModules()` + dynamic `import()` of observability/sentry.ts so
 * the module's `initialized` singleton starts fresh and picks up that test's specific mock
 * implementation, rather than sharing state across tests in this file.
 */
const mockInit = vi.fn();
const mockCaptureException = vi.fn();
const mockFlush = vi.fn();

vi.mock('@sentry/node', () => ({
  init: (...args: unknown[]) => mockInit(...args),
  captureException: (...args: unknown[]) => mockCaptureException(...args),
  flush: (...args: unknown[]) => mockFlush(...args),
}));

describe('Sentry defensive wrappers never throw (Phase 3.9)', () => {
  beforeEach(() => {
    vi.resetModules();
    mockInit.mockReset();
    mockCaptureException.mockReset();
    mockFlush.mockReset();
  });

  it('initSentry catches a Sentry.init failure and leaves error tracking disabled rather than throwing', async () => {
    mockInit.mockImplementation(() => {
      throw new Error('simulated init failure');
    });
    const { initSentry, isSentryInitialized } = await import('../observability/sentry');

    expect(() => initSentry({ dsn: 'https://fakepublickey@fake.ingest.sentry.io/1' })).not.toThrow();
    expect(isSentryInitialized()).toBe(false);
  });

  it('captureError catches a Sentry.captureException failure rather than throwing into its caller', async () => {
    mockInit.mockImplementation(() => undefined);
    mockCaptureException.mockImplementation(() => {
      throw new Error('simulated captureException failure');
    });
    const { initSentry, captureError, isSentryInitialized } = await import('../observability/sentry');
    initSentry({ dsn: 'https://fakepublickey@fake.ingest.sentry.io/1' });
    expect(isSentryInitialized()).toBe(true);

    // This is the call site that matters most: process-safety.ts's fatal-error handlers call this
    // as their last action before exiting — it must never itself become a new way to crash.
    expect(() => captureError(new Error('irrelevant'))).not.toThrow();
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
  });

  it('flushSentry catches a Sentry.flush failure and still resolves (never rejects, never hangs)', async () => {
    mockInit.mockImplementation(() => undefined);
    mockFlush.mockImplementation(() => {
      throw new Error('simulated flush failure');
    });
    const { initSentry, flushSentry } = await import('../observability/sentry');
    initSentry({ dsn: 'https://fakepublickey@fake.ingest.sentry.io/1' });

    await expect(flushSentry()).resolves.toBeUndefined();
    expect(mockFlush).toHaveBeenCalledTimes(1);
  });

  it('captureError never calls the SDK at all when Sentry was never initialized (no DSN)', async () => {
    const { initSentry, captureError, isSentryInitialized } = await import('../observability/sentry');
    initSentry({ dsn: undefined });
    expect(isSentryInitialized()).toBe(false);

    captureError(new Error('should never reach the SDK'));
    expect(mockCaptureException).not.toHaveBeenCalled();
  });
});
