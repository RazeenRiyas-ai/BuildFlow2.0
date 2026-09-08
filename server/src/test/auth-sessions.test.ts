import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { app } from '../app';
import { pool } from '../config/db';
import { deleteUserByPhone, uniquePhone } from './db-helpers';

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

describe('Refresh token rotation lifecycle', () => {
  it('register creates a refresh_tokens row for the new user', async () => {
    const phone = uniquePhone();
    const res = await request(app)
      .post('/auth/register')
      .send({ name: 'Session Test', phone, password: 'password123' });
    expect(res.status).toBe(201);

    const row = await pool.query('SELECT revoked_at, replaced_by FROM refresh_tokens WHERE token_hash = $1', [
      hashToken(res.body.refreshToken),
    ]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].revoked_at).toBeNull();
    expect(row.rows[0].replaced_by).toBeNull();

    await deleteUserByPhone(phone);
  });

  it('login creates a refresh_tokens row', async () => {
    const phone = uniquePhone();
    const password = 'password123';
    await request(app).post('/auth/register').send({ name: 'Login Session Test', phone, password });

    const res = await request(app).post('/auth/login').send({ phone, password });
    expect(res.status).toBe(200);

    const row = await pool.query('SELECT id FROM refresh_tokens WHERE token_hash = $1', [
      hashToken(res.body.refreshToken),
    ]);
    expect(row.rows).toHaveLength(1);

    await deleteUserByPhone(phone);
  });

  it('rotates the refresh token on use and revokes the old one', async () => {
    const phone = uniquePhone();
    const reg = await request(app)
      .post('/auth/register')
      .send({ name: 'Rotation Test', phone, password: 'password123' });
    const oldToken = reg.body.refreshToken;

    const refreshRes = await request(app).post('/auth/refresh').send({ refreshToken: oldToken });
    expect(refreshRes.status).toBe(200);
    const newToken = refreshRes.body.refreshToken;
    expect(newToken).not.toBe(oldToken);

    const oldRow = await pool.query('SELECT revoked_at, replaced_by FROM refresh_tokens WHERE token_hash = $1', [
      hashToken(oldToken),
    ]);
    expect(oldRow.rows[0].revoked_at).not.toBeNull();
    expect(oldRow.rows[0].replaced_by).not.toBeNull();

    const newRow = await pool.query('SELECT revoked_at FROM refresh_tokens WHERE token_hash = $1', [
      hashToken(newToken),
    ]);
    expect(newRow.rows[0].revoked_at).toBeNull();

    await deleteUserByPhone(phone);
  });

  it('rejects reuse of an already-rotated refresh token and revokes the whole family', async () => {
    const phone = uniquePhone();
    const reg = await request(app)
      .post('/auth/register')
      .send({ name: 'Reuse Test', phone, password: 'password123' });
    const firstToken = reg.body.refreshToken;

    const firstRefresh = await request(app).post('/auth/refresh').send({ refreshToken: firstToken });
    expect(firstRefresh.status).toBe(200);
    const secondToken = firstRefresh.body.refreshToken;

    const reuseRes = await request(app).post('/auth/refresh').send({ refreshToken: firstToken });
    expect(reuseRes.status).toBe(401);
    expect(reuseRes.body.code).toBe('REFRESH_TOKEN_REUSED');

    // The legitimately-rotated-to second token must ALSO be dead now — reuse kills the whole family,
    // not just the one token that was reused.
    const secondAttempt = await request(app).post('/auth/refresh').send({ refreshToken: secondToken });
    expect(secondAttempt.status).toBe(401);

    await deleteUserByPhone(phone);
  });

  it('logout revokes the current refresh token', async () => {
    const phone = uniquePhone();
    const reg = await request(app)
      .post('/auth/register')
      .send({ name: 'Logout Test', phone, password: 'password123' });
    const refreshToken = reg.body.refreshToken;

    const logoutRes = await request(app).post('/auth/logout').send({ refreshToken });
    expect(logoutRes.status).toBe(204);

    const afterLogout = await request(app).post('/auth/refresh').send({ refreshToken });
    expect(afterLogout.status).toBe(401);
    expect(afterLogout.body.code).toBe('REFRESH_TOKEN_REVOKED');

    await deleteUserByPhone(phone);
  });
});

afterAll(async () => {
  await pool.end();
});
