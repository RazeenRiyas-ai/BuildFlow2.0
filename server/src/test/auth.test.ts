import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { pool } from '../config/db';
import { deleteUserByPhone, uniquePhone } from './db-helpers';

describe('POST /auth/register', () => {
  const phone = uniquePhone();

  afterAll(async () => {
    await deleteUserByPhone(phone);
  });

  it('registers a new contractor and returns tokens', async () => {
    const res = await request(app).post('/auth/register').send({
      name: 'Test Contractor',
      companyName: 'Test Co',
      phone,
      password: 'password123',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('contractor');
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
  });

  it('rejects duplicate phone registration with 409', async () => {
    const res = await request(app).post('/auth/register').send({
      name: 'Test Contractor 2',
      phone,
      password: 'password123',
    });
    expect(res.status).toBe(409);
  });

  it('rejects invalid input with 400', async () => {
    const res = await request(app).post('/auth/register').send({
      name: 'X',
      phone: '123',
      password: 'short',
    });
    expect(res.status).toBe(400);
  });

  it('ignores a client-supplied role and always creates a contractor', async () => {
    const tamperedPhone = uniquePhone();
    const res = await request(app).post('/auth/register').send({
      name: 'Privilege Escalation Attempt',
      phone: tamperedPhone,
      password: 'password123',
      role: 'hq_admin',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('contractor');

    const dbRow = await pool.query('SELECT role FROM users WHERE phone = $1', [tamperedPhone]);
    expect(dbRow.rows[0].role).toBe('contractor');

    await deleteUserByPhone(tamperedPhone);
  });
});

describe('POST /auth/login', () => {
  const phone = uniquePhone();
  const password = 'password123';

  beforeAll(async () => {
    await request(app).post('/auth/register').send({ name: 'Login Test', phone, password });
  });

  afterAll(async () => {
    await deleteUserByPhone(phone);
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app).post('/auth/login').send({ phone, password });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it('rejects wrong password with 401', async () => {
    const res = await request(app).post('/auth/login').send({ phone, password: 'wrongpass' });
    expect(res.status).toBe(401);
  });

  it('rejects unknown phone with 401', async () => {
    const res = await request(app).post('/auth/login').send({ phone: '+91 90000 99999', password });
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/refresh', () => {
  const phone = uniquePhone();
  const password = 'password123';
  let refreshToken: string;

  beforeAll(async () => {
    const res = await request(app).post('/auth/register').send({ name: 'Refresh Test', phone, password });
    refreshToken = res.body.refreshToken;
  });

  afterAll(async () => {
    await deleteUserByPhone(phone);
  });

  it('issues new tokens for a valid refresh token', async () => {
    const res = await request(app).post('/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it('rejects an invalid refresh token with 401', async () => {
    const res = await request(app).post('/auth/refresh').send({ refreshToken: 'not-a-real-token' });
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('returns 204 given any refresh token, revoked or not', async () => {
    const res = await request(app).post('/auth/logout').send({ refreshToken: 'not-a-real-token' });
    expect(res.status).toBe(204);
  });

  it('rejects a missing refreshToken with 400', async () => {
    const res = await request(app).post('/auth/logout').send({});
    expect(res.status).toBe(400);
  });
});

afterAll(async () => {
  await pool.end();
});
