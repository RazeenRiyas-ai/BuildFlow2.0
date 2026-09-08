import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../app';
import { pool } from '../config/db';
import { env } from '../config/env';
import { deleteUserByPhone, uniquePhone } from './db-helpers';

function decodeAccessTokenPayload(accessToken: string) {
  return JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString());
}

// Split from auth-sessions.test.ts so this file's own register/login volume stays comfortably
// under authRateLimit (10/min) — each test file gets an isolated rate-limiter counter, but the
// budget must still be respected within any single file.
describe('Account state enforcement at refresh time', () => {
  it('rejects an expired refresh token deterministically (no 30-day wait)', async () => {
    const phone = uniquePhone();
    const reg = await request(app)
      .post('/auth/register')
      .send({ name: 'Expiry Test', phone, password: 'password123' });
    const userId = reg.body.user.id;

    const expiredToken = jwt.sign(
      { sub: userId, role: 'contractor', tokenVersion: 0, jti: 'expiry-test' },
      env.JWT_REFRESH_SECRET,
      { expiresIn: '-1s' },
    );
    const res = await request(app).post('/auth/refresh').send({ refreshToken: expiredToken });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('REFRESH_TOKEN_INVALID');

    await deleteUserByPhone(phone);
  });

  it('rejects login and refresh for a disabled account', async () => {
    const phone = uniquePhone();
    const password = 'password123';
    const reg = await request(app).post('/auth/register').send({ name: 'Disabled Test', phone, password });
    const refreshToken = reg.body.refreshToken;
    const userId = reg.body.user.id;

    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [userId]);

    const refreshRes = await request(app).post('/auth/refresh').send({ refreshToken });
    expect(refreshRes.status).toBe(401);
    expect(refreshRes.body.code).toBe('ACCOUNT_DISABLED');

    const loginRes = await request(app).post('/auth/login').send({ phone, password });
    expect(loginRes.status).toBe(401);
    expect(loginRes.body.code).toBe('ACCOUNT_DISABLED');

    await deleteUserByPhone(phone);
  });

  it('rejects refresh for a deleted account', async () => {
    const phone = uniquePhone();
    const reg = await request(app)
      .post('/auth/register')
      .send({ name: 'Deleted Test', phone, password: 'password123' });
    const refreshToken = reg.body.refreshToken;
    const userId = reg.body.user.id;

    await pool.query('DELETE FROM users WHERE id = $1', [userId]);

    const res = await request(app).post('/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(401);
    // No further cleanup: cascading FKs already removed the user, contractor, and refresh_token rows.
  });

  it('reflects a role changed in the database, not the stale claim in the presented refresh token', async () => {
    const phone = uniquePhone();
    const reg = await request(app)
      .post('/auth/register')
      .send({ name: 'Role Change Test', phone, password: 'password123' });
    const refreshToken = reg.body.refreshToken;
    const userId = reg.body.user.id;
    expect(reg.body.user.role).toBe('contractor');

    await pool.query("UPDATE users SET role = 'hq_staff' WHERE id = $1", [userId]);

    const res = await request(app).post('/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(200);
    expect(decodeAccessTokenPayload(res.body.accessToken).role).toBe('hq_staff');

    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  });

  it('invalidates an outstanding refresh token when token_version is bumped', async () => {
    const phone = uniquePhone();
    const reg = await request(app)
      .post('/auth/register')
      .send({ name: 'Token Version Test', phone, password: 'password123' });
    const refreshToken = reg.body.refreshToken;
    const userId = reg.body.user.id;

    await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [userId]);

    const res = await request(app).post('/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SESSION_INVALIDATED');

    await deleteUserByPhone(phone);
  });
});

afterAll(async () => {
  await pool.end();
});
