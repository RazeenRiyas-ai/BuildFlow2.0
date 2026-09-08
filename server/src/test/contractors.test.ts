import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { pool } from '../config/db';
import { deleteUserByPhone, uniquePhone } from './db-helpers';

describe('GET /contractors/me', () => {
  const phone = uniquePhone();
  const password = 'password123';
  let token: string;
  let hqToken: string;

  beforeAll(async () => {
    const reg = await request(app).post('/auth/register').send({
      name: 'Contractor Me Test',
      companyName: 'Me Test Co',
      phone,
      password,
    });
    token = reg.body.accessToken;

    const hqLogin = await request(app).post('/auth/login').send({ phone: '+91 90000 00001', password: 'password123' });
    hqToken = hqLogin.body.accessToken;
  });

  afterAll(async () => {
    await deleteUserByPhone(phone);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/contractors/me');
    expect(res.status).toBe(401);
  });

  it('rejects HQ admin with 403', async () => {
    const res = await request(app).get('/contractors/me').set('Authorization', 'Bearer ' + hqToken);
    expect(res.status).toBe(403);
  });

  it('returns the authenticated contractor profile', async () => {
    const res = await request(app).get('/contractors/me').set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Contractor Me Test');
    expect(res.body.companyName).toBe('Me Test Co');
    expect(res.body.phone).toBe(phone);
  });
});

afterAll(async () => {
  await pool.end();
});
