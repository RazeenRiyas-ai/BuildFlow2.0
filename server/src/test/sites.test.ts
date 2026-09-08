import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { pool } from '../config/db';
import { deleteUserByPhone, uniquePhone } from './db-helpers';

describe('GET /sites', () => {
  const phoneA = uniquePhone();
  const phoneB = uniquePhone();
  const password = 'password123';
  let tokenA: string;
  let tokenB: string;
  let contractorAId: string;
  let contractorBId: string;
  let siteAId: string;
  let siteBId: string;
  let hqToken: string;

  beforeAll(async () => {
    const regA = await request(app).post('/auth/register').send({ name: 'Contractor A', phone: phoneA, password: password });
    tokenA = regA.body.accessToken;
    contractorAId = regA.body.user.id;

    const regB = await request(app).post('/auth/register').send({ name: 'Contractor B', phone: phoneB, password: password });
    tokenB = regB.body.accessToken;
    contractorBId = regB.body.user.id;

    const insertSql = 'INSERT INTO construction_sites (contractor_id, label, address) VALUES ($1, $2, $3) RETURNING id';

    const siteA = await pool.query(insertSql, [contractorAId, 'Site A', 'Address A']);
    siteAId = siteA.rows[0].id;

    const siteB = await pool.query(insertSql, [contractorBId, 'Site B', 'Address B']);
    siteBId = siteB.rows[0].id;

    const hqLogin = await request(app).post('/auth/login').send({ phone: '+91 90000 00001', password: 'password123' });
    hqToken = hqLogin.body.accessToken;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM construction_sites WHERE id = ANY($1)', [[siteAId, siteBId]]);
    await deleteUserByPhone(phoneA);
    await deleteUserByPhone(phoneB);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/sites');
    expect(res.status).toBe(401);
  });

  it('rejects HQ admin with 403', async () => {
    const res = await request(app).get('/sites').set('Authorization', 'Bearer ' + hqToken);
    expect(res.status).toBe(403);
  });

  it('returns only the authenticated contractor own sites', async () => {
    const res = await request(app).get('/sites').set('Authorization', 'Bearer ' + tokenA);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(siteAId);
    expect(res.body[0].label).toBe('Site A');
  });

  it('isolates contractor B from contractor A sites', async () => {
    const res = await request(app).get('/sites').set('Authorization', 'Bearer ' + tokenB);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(siteBId);
  });

  it('ignores query-param tampering with another contractor id', async () => {
    const res = await request(app)
      .get('/sites')
      .query({ contractorId: contractorBId })
      .set('Authorization', 'Bearer ' + tokenA);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(siteAId);
  });

  it('ignores body tampering with another contractor id', async () => {
    const res = await request(app)
      .get('/sites')
      .send({ contractorId: contractorBId })
      .set('Authorization', 'Bearer ' + tokenA);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(siteAId);
  });
});

describe('POST /sites', () => {
  const phoneC = uniquePhone();
  const password = 'password123';
  let tokenC: string;
  let hqToken: string;
  let createdSiteId: string;

  beforeAll(async () => {
    const regC = await request(app).post('/auth/register').send({ name: 'Contractor C', phone: phoneC, password: password });
    tokenC = regC.body.accessToken;

    const hqLogin = await request(app).post('/auth/login').send({ phone: '+91 90000 00001', password: 'password123' });
    hqToken = hqLogin.body.accessToken;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM construction_sites WHERE id = $1', [createdSiteId]);
    await deleteUserByPhone(phoneC);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).post('/sites').send({ label: 'Site X', address: 'Address X' });
    expect(res.status).toBe(401);
  });

  it('rejects HQ admin with 403', async () => {
    const res = await request(app)
      .post('/sites')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ label: 'Site X', address: 'Address X' });
    expect(res.status).toBe(403);
  });

  it('rejects a missing label with 400', async () => {
    const res = await request(app)
      .post('/sites')
      .set('Authorization', 'Bearer ' + tokenC)
      .send({ address: 'Address X' });
    expect(res.status).toBe(400);
  });

  it('creates a site scoped to the authenticated contractor, ignoring a tampered contractorId', async () => {
    const res = await request(app)
      .post('/sites')
      .set('Authorization', 'Bearer ' + tokenC)
      .send({ label: 'Site X', address: 'Address X', notes: 'Gate code 1234', contractorId: 'should-be-ignored' });
    expect(res.status).toBe(201);
    expect(res.body.label).toBe('Site X');
    expect(res.body.notes).toBe('Gate code 1234');
    createdSiteId = res.body.id;

    const list = await request(app).get('/sites').set('Authorization', 'Bearer ' + tokenC);
    expect(list.body.some((s: any) => s.id === createdSiteId)).toBe(true);
  });
});

afterAll(async () => {
  await pool.end();
});
