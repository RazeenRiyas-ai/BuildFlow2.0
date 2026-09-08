import { describe, it, expect } from 'vitest';
import { createLogger, truncateSecret, type LogLevel } from '../utils/logger';
import { runWithRequestId, getRequestId } from '../utils/request-context';

function makeCapturingLogger(minLevel?: LogLevel) {
  const lines: { level: LogLevel; line: string }[] = [];
  const logger = createLogger({
    minLevel,
    sink: (level, line) => lines.push({ level, line }),
  });
  return { logger, lines };
}

describe('logger — structured JSON output', () => {
  it('info() produces one valid, single-line JSON object with timestamp/level/message', () => {
    const { logger, lines } = makeCapturingLogger();
    logger.info('Order created');

    expect(lines).toHaveLength(1);
    expect(lines[0].line.includes('\n')).toBe(false);

    const entry = JSON.parse(lines[0].line);
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('Order created');
    expect(typeof entry.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(entry.timestamp))).toBe(false);
  });

  it('warn() produces an entry with level "warn"', () => {
    const { logger, lines } = makeCapturingLogger();
    logger.warn('pool error on an idle client');

    const entry = JSON.parse(lines[0].line);
    expect(entry.level).toBe('warn');
    expect(lines[0].level).toBe('warn');
  });

  it('a log entry is never split across multiple lines, even when the message contains a newline', () => {
    const { logger, lines } = makeCapturingLogger();
    logger.info('line one\nline two');

    expect(lines).toHaveLength(1);
    expect(lines[0].line.includes('\n')).toBe(false);
    expect(JSON.parse(lines[0].line).message).toBe('line one\nline two');
  });

  it('debug/info route to the stdout-shaped sink call, warn/error to the stderr-shaped one', () => {
    const { logger, lines } = makeCapturingLogger('debug');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(lines.map((l) => l.level)).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('respects a configured minimum level, dropping lower-severity entries', () => {
    const { logger, lines } = makeCapturingLogger('warn');
    logger.debug('should be dropped');
    logger.info('should be dropped too');
    logger.warn('kept');
    logger.error('kept too');

    expect(lines).toHaveLength(2);
    expect(lines.map((l) => JSON.parse(l.line).message)).toEqual(['kept', 'kept too']);
  });
});

describe('logger — error serialization', () => {
  it('error() serializes a real Error into name/message/stack without crashing', () => {
    const { logger, lines } = makeCapturingLogger();
    const err = new TypeError('boom');
    logger.error('Something failed', err);

    const entry = JSON.parse(lines[0].line);
    expect(entry.level).toBe('error');
    expect(entry.message).toBe('Something failed');
    expect(entry.error.name).toBe('TypeError');
    expect(entry.error.message).toBe('boom');
    expect(typeof entry.error.stack).toBe('string');
    expect(entry.error.stack).toContain('TypeError: boom');
  });

  it('error() handles a non-Error thrown value without crashing', () => {
    const { logger, lines } = makeCapturingLogger();
    logger.error('Something failed', 'a plain string reason');

    const entry = JSON.parse(lines[0].line);
    expect(entry.error.message).toBe('a plain string reason');
  });

  it('error() works with no error argument at all', () => {
    const { logger, lines } = makeCapturingLogger();
    expect(() => logger.error('just a message')).not.toThrow();
    expect(JSON.parse(lines[0].line).error).toBeUndefined();
  });
});

describe('logger — request-context integration', () => {
  it('automatically includes the current request ID without it being passed manually', async () => {
    const { logger, lines } = makeCapturingLogger();

    await runWithRequestId('req-123', async () => {
      logger.info('inside request');
    });

    expect(JSON.parse(lines[0].line).requestId).toBe('req-123');
  });

  it('includes the request ID across an awaited async gap (deeper service-layer call)', async () => {
    const { logger, lines } = makeCapturingLogger();

    async function deepServiceCall() {
      await new Promise((resolve) => setTimeout(resolve, 5));
      logger.info('deep in a service function');
    }

    await runWithRequestId('req-456', () => deepServiceCall());

    expect(JSON.parse(lines[0].line).requestId).toBe('req-456');
  });

  it('logging outside any request context does not crash and does not invent a request ID', () => {
    expect(getRequestId()).toBeUndefined();
    const { logger, lines } = makeCapturingLogger();

    expect(() => logger.info('no request in flight')).not.toThrow();

    const entry = JSON.parse(lines[0].line);
    expect(entry.requestId).toBeUndefined();
    expect('requestId' in entry).toBe(false);
  });

  it('keeps concurrent request contexts correctly isolated', async () => {
    const { logger, lines } = makeCapturingLogger();

    await Promise.all([
      runWithRequestId('context-a', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        logger.info('from A');
      }),
      runWithRequestId('context-b', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        logger.info('from B');
      }),
    ]);

    const byMessage = Object.fromEntries(lines.map((l) => [JSON.parse(l.line).message, JSON.parse(l.line).requestId]));
    expect(byMessage['from A']).toBe('context-a');
    expect(byMessage['from B']).toBe('context-b');
  });
});

describe('logger — structured metadata', () => {
  it('preserves arbitrary structured metadata fields alongside the standard ones', () => {
    const { logger, lines } = makeCapturingLogger();
    logger.info('Order created', { orderId: 'order-456', quantity: 3, tags: ['urgent'] });

    const entry = JSON.parse(lines[0].line);
    expect(entry.orderId).toBe('order-456');
    expect(entry.quantity).toBe(3);
    expect(entry.tags).toEqual(['urgent']);
  });
});

describe('logger — sensitive-data protection', () => {
  it('fully redacts password/secret/authorization/cookie-shaped metadata fields', () => {
    const { logger, lines } = makeCapturingLogger();
    logger.info('login attempt', {
      password: 'hunter2',
      authorization: 'Bearer eyJhbGciOi...',
      apiKey: 'sk-live-abcdef123456',
      cookie: 'session=abc123',
      refreshSecret: 'super-secret-value',
    });

    const entry = JSON.parse(lines[0].line);
    expect(entry.password).toBe('[REDACTED]');
    expect(entry.authorization).toBe('[REDACTED]');
    expect(entry.apiKey).toBe('[REDACTED]');
    expect(entry.cookie).toBe('[REDACTED]');
    expect(entry.refreshSecret).toBe('[REDACTED]');
    expect(lines[0].line).not.toContain('hunter2');
    expect(lines[0].line).not.toContain('super-secret-value');
  });

  it('redacts sensitive fields nested inside metadata objects, not just top-level ones', () => {
    const { logger, lines } = makeCapturingLogger();
    logger.info('request failed', { context: { user: { password: 'hunter2' } } });

    expect(lines[0].line).not.toContain('hunter2');
  });

  it('truncates token/jwt-shaped fields rather than logging them in full', () => {
    const { logger, lines } = makeCapturingLogger();
    const fakeAccessToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz';
    logger.info('token check', { accessToken: fakeAccessToken });

    const entry = JSON.parse(lines[0].line);
    expect(entry.accessToken).not.toBe(fakeAccessToken);
    expect(lines[0].line).not.toContain(fakeAccessToken);
    // Still recognizably a truncated preview, not just a blank marker — useful for correlation.
    expect(entry.accessToken).toContain(fakeAccessToken.slice(0, 6));
  });

  it('truncateSecret redacts very short values entirely rather than truncating them into nothing', () => {
    expect(truncateSecret('short')).toBe('[REDACTED]');
  });
});

describe('logger — Expo push token redaction (Phase 2.6.3 known issue fix)', () => {
  it('never emits a full Expo push token when logging a delivery failure', () => {
    const { logger, lines } = makeCapturingLogger();
    const realExpoToken = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';

    logger.error('sendPushToHqDevices: delivery failed for a token', undefined, {
      expoPushToken: realExpoToken,
      error: 'DeviceNotRegistered',
    });

    const entry = JSON.parse(lines[0].line);
    expect(entry.expoPushToken).not.toBe(realExpoToken);
    expect(lines[0].line).not.toContain(realExpoToken);
    expect(entry.error).toBe('DeviceNotRegistered');
  });
});
