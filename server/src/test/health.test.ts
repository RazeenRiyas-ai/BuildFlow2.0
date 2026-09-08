import { describe, it, expect, afterEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { app } from '../app';
import { pool } from '../config/db';
import { createHealthRouter, type CreateHealthRouterOptions } from '../health/health.routes';
import { checkDatabaseConnectivity, type QueryableDatabase } from '../health/db-check';
import { markShuttingDown, isShuttingDown, resetForTests } from '../health/readiness-state';

/** An isolated Express app wired only with the health router under test — never the real global
 * `pool` unless explicitly passed in. This is exactly the DI seam db-check.ts/health.routes.ts
 * expose so a database failure (or a hang) can be simulated deterministically without ever
 * touching or closing the real shared pool that every other test file in this suite still depends
 * on (see graceful-shutdown.ts's own ClosablePool/ClosableServer interfaces for the same pattern). */
function buildTestApp(options?: CreateHealthRouterOptions) {
  const testApp = express();
  testApp.use('/health', createHealthRouter(options));
  return testApp;
}

function fakeDb(query: (text: string) => Promise<unknown>): QueryableDatabase {
  return { query };
}

describe('GET /health/live', () => {
  it('returns 200 with a small, safe body', async () => {
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('never queries the database, even if the database is broken', async () => {
    const explodingDb = fakeDb(() => {
      throw new Error('the liveness check must never reach this');
    });
    const testApp = buildTestApp({ db: explodingDb });

    const res = await request(testApp).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('is not cacheable', async () => {
    const res = await request(app).get('/health/live');
    expect(res.headers['cache-control']).toContain('no-store');
  });
});

describe('GET /health/ready — database connectivity', () => {
  it('returns 200 when Postgres is reachable (real pool, real database)', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('performs a lightweight query (SELECT 1) against the injected database', async () => {
    const seenQueries: string[] = [];
    const testApp = buildTestApp({
      db: fakeDb(async (text) => {
        seenQueries.push(text);
        return { rows: [{ '?column?': 1 }] };
      }),
    });

    const res = await request(testApp).get('/health/ready');
    expect(res.status).toBe(200);
    expect(seenQueries).toEqual(['SELECT 1']);
  });

  it('returns 503 when the database check fails, without leaking the underlying error', async () => {
    const testApp = buildTestApp({
      db: fakeDb(async () => {
        throw new Error('password authentication failed for user "buildflow" at host 10.0.4.12');
      }),
    });

    const res = await request(testApp).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable' });

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('10.0.4.12');
    expect(raw).not.toContain('password authentication failed');
    expect(raw).not.toContain('buildflow');
  });

  it('returns 503 (not a hang) when the database check times out', async () => {
    const testApp = buildTestApp({
      db: fakeDb(() => new Promise(() => {})), // never resolves
      dbCheckTimeoutMs: 50,
    });

    const startedAt = Date.now();
    const res = await request(testApp).get('/health/ready');
    const elapsedMs = Date.now() - startedAt;

    expect(res.status).toBe(503);
    expect(elapsedMs).toBeLessThan(2000);
  });

  it('recovers to 200 once the database becomes reachable again after a failure', async () => {
    let shouldFail = true;
    const testApp = buildTestApp({
      db: fakeDb(async () => {
        if (shouldFail) throw new Error('connection refused');
        return { rows: [{ '?column?': 1 }] };
      }),
    });

    const failing = await request(testApp).get('/health/ready');
    expect(failing.status).toBe(503);

    shouldFail = false;
    const recovered = await request(testApp).get('/health/ready');
    expect(recovered.status).toBe(200);
    expect(recovered.body).toEqual({ status: 'ok' });
  });

  it('is not cacheable', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('does not use the normal application error-taxonomy response shape', async () => {
    const testApp = buildTestApp({
      db: fakeDb(async () => {
        throw new Error('down');
      }),
    });
    const res = await request(testApp).get('/health/ready');
    // { status: 'unavailable' } only — no `error`/`code`/`requestId` fields from errorHandler.ts's
    // application error contract (Phase 2.6.5). Health is an infrastructure signal, not a business
    // error response.
    expect(Object.keys(res.body)).toEqual(['status']);
  });
});

describe('GET /health/ready — shutdown integration', () => {
  afterEach(() => {
    // readiness-state is a process-global singleton by design (see readiness-state.ts) — reset it
    // between tests in this describe block so marking shutdown in one test can't leak into
    // another. Every other test file's own health checks run through the real `app`, which never
    // calls markShuttingDown() outside of a real graceful-shutdown sequence, so this reset is
    // scoped to this file's own deliberate simulation.
    resetForTests();
  });

  it('returns 503 immediately once shutdown has been marked, without even attempting a database check', async () => {
    const seenQueries: string[] = [];
    const testApp = buildTestApp({
      db: fakeDb(async (text) => {
        seenQueries.push(text);
        return { rows: [{ '?column?': 1 }] };
      }),
    });

    markShuttingDown();
    const res = await request(testApp).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable' });
    expect(seenQueries).toEqual([]);
  });

  it('shutdown state is idempotent to observe: marking it more than once has no additional effect', async () => {
    markShuttingDown();
    markShuttingDown();
    expect(isShuttingDown()).toBe(true);
  });
});

describe('checkDatabaseConnectivity (unit)', () => {
  it('resolves { ok: true } when the query succeeds', async () => {
    const result = await checkDatabaseConnectivity(fakeDb(async () => ({ rows: [] })));
    expect(result.ok).toBe(true);
  });

  it('resolves { ok: false, error } when the query rejects, and never throws', async () => {
    const result = await checkDatabaseConnectivity(fakeDb(async () => Promise.reject(new Error('boom'))));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
    }
  });

  it('uses the real shared pool by default (no second pool created)', async () => {
    const result = await checkDatabaseConnectivity();
    expect(result.ok).toBe(true);
  });
});

afterAll(async () => {
  await pool.end();
});
