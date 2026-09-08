import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { pool } from '../config/db';
import { ErrorCode } from '../errors/error-codes';
import { deleteUserByPhone, uniquePhone } from './db-helpers';

// Isolated in its own file so its request volume can't tip other tests' /auth/* calls over the
// same rate-limit window (vitest runs each test file in its own isolated module registry, so
// authRateLimit's in-memory counter here starts fresh).
describe('POST /auth/refresh rate limiting', () => {
  it('rate-limits excessive refresh attempts from the same client, with the standard RATE_LIMITED error shape', async () => {
    const phone = uniquePhone();
    const reg = await request(app)
      .post('/auth/register')
      .send({ name: 'Rate Limit Test', phone, password: 'password123' });
    const refreshToken = reg.body.refreshToken;

    const responses: { status: number; body: unknown }[] = [];
    for (let i = 0; i < 35; i++) {
      // Reusing the same token repeatedly is fine here — after the first successful rotation every
      // later call will be a REUSED 401, but the rate limiter counts requests, not outcomes.
      const res = await request(app).post('/auth/refresh').send({ refreshToken });
      responses.push({ status: res.status, body: res.body });
    }

    const statuses = responses.map((r) => r.status);
    expect(statuses).toContain(429);

    const limited = responses.find((r) => r.status === 429)!.body as { error: string; code: string; requestId?: string };
    expect(limited.code).toBe(ErrorCode.RATE_LIMITED);
    expect(typeof limited.error).toBe('string');
    expect(typeof limited.requestId).toBe('string');

    await deleteUserByPhone(phone);
  });
});

afterAll(async () => {
  await pool.end();
});
