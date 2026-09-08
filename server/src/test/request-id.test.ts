import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { pool } from '../config/db';
import { REQUEST_ID_HEADER } from '../middleware/request-id';
import { runWithRequestId, getRequestId } from '../utils/request-context';

const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

describe('request/correlation ID — HTTP behavior', () => {
  it('generates a request ID when none is supplied', async () => {
    const res = await request(app).get('/categories');
    expect(res.status).toBe(200);
    const id = res.headers['x-request-id'];
    expect(id).toBeDefined();
    expect(SAFE_ID_PATTERN.test(id)).toBe(true);
  });

  it('preserves a valid caller-supplied request ID', async () => {
    const suppliedId = 'client-supplied-id-123';
    const res = await request(app).get('/categories').set(REQUEST_ID_HEADER, suppliedId);
    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBe(suppliedId);
  });

  it('generates a fresh ID instead of trusting an oversized one', async () => {
    const oversized = 'a'.repeat(300);
    const res = await request(app).get('/categories').set(REQUEST_ID_HEADER, oversized);
    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-request-id']).not.toBe(oversized);
    expect(res.headers['x-request-id'].length).toBeLessThanOrEqual(128);
    expect(SAFE_ID_PATTERN.test(res.headers['x-request-id'])).toBe(true);
  });

  it('generates a fresh ID instead of reflecting one with unsafe characters', async () => {
    const malformed = 'bad id; drop table orders -- <script>';
    const res = await request(app).get('/categories').set(REQUEST_ID_HEADER, malformed);
    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-request-id']).not.toBe(malformed);
    expect(SAFE_ID_PATTERN.test(res.headers['x-request-id'])).toBe(true);
  });

  it('a 404 error response still carries the request ID header', async () => {
    const res = await request(app).get('/categories/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers['x-request-id']).toBeDefined();
    expect(SAFE_ID_PATTERN.test(res.headers['x-request-id'])).toBe(true);
  });

  it('a validation-error (400) response still carries the request ID header', async () => {
    const res = await request(app).post('/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('existing routes continue to work normally, and still get the header', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('concurrent requests receive different IDs and do not leak into each other', async () => {
    const [resA, resB] = await Promise.all([
      request(app).get('/categories').set(REQUEST_ID_HEADER, 'concurrent-request-a'),
      request(app).get('/categories').set(REQUEST_ID_HEADER, 'concurrent-request-b'),
    ]);

    expect(resA.headers['x-request-id']).toBe('concurrent-request-a');
    expect(resB.headers['x-request-id']).toBe('concurrent-request-b');
  });
});

describe('request/correlation ID — AsyncLocalStorage propagation', () => {
  it('is readable from nested async work without being passed as an argument', async () => {
    const observed: (string | undefined)[] = [];

    await runWithRequestId('outer-id', async () => {
      observed.push(getRequestId());
      await new Promise((resolve) => setTimeout(resolve, 5));
      observed.push(getRequestId());
      await Promise.resolve().then(() => observed.push(getRequestId()));
    });

    expect(observed).toEqual(['outer-id', 'outer-id', 'outer-id']);
  });

  it('is undefined outside of any request context', () => {
    expect(getRequestId()).toBeUndefined();
  });

  it('does not leak between two concurrently running request contexts', async () => {
    const resultsA: (string | undefined)[] = [];
    const resultsB: (string | undefined)[] = [];

    await Promise.all([
      runWithRequestId('context-a', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        resultsA.push(getRequestId());
      }),
      runWithRequestId('context-b', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        resultsB.push(getRequestId());
      }),
    ]);

    expect(resultsA).toEqual(['context-a']);
    expect(resultsB).toEqual(['context-b']);
  });
});

afterAll(async () => {
  await pool.end();
});
