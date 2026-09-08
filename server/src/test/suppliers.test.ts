import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { pool } from '../config/db';
import { uniquePhone } from './db-helpers';

describe('GET /suppliers', () => {
  let hqToken: string;
  let contractorToken: string;
  const contractorPhone = uniquePhone();

  beforeAll(async () => {
    const hqLogin = await request(app).post('/auth/login').send({ phone: '+91 90000 00001', password: 'password123' });
    hqToken = hqLogin.body.accessToken;

    const reg = await request(app)
      .post('/auth/register')
      .send({ name: 'Supplier List Tester', phone: contractorPhone, password: 'password123' });
    contractorToken = reg.body.accessToken;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE phone = $1', [contractorPhone]);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/suppliers');
    expect(res.status).toBe(401);
  });

  it('rejects a contractor with 403', async () => {
    const res = await request(app).get('/suppliers').set('Authorization', 'Bearer ' + contractorToken);
    expect(res.status).toBe(403);
  });

  it('returns all suppliers for HQ staff, including phone (this is the HQ-only operational view)', async () => {
    const res = await request(app).get('/suppliers').set('Authorization', 'Bearer ' + hqToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(6);
    expect(res.body[0]).toHaveProperty('id');
    expect(res.body[0]).toHaveProperty('name');
    expect(res.body[0]).toHaveProperty('locality');
    expect(res.body[0]).toHaveProperty('phone');
  });
});

describe('GET /suppliers/:id', () => {
  let supplierId: string;
  let hqToken: string;
  let contractorToken: string;
  const contractorPhone = uniquePhone();

  beforeAll(async () => {
    const materials = await request(app).get('/materials');
    supplierId = materials.body[0].supplierId;

    const hqLogin = await request(app).post('/auth/login').send({ phone: '+91 90000 00001', password: 'password123' });
    hqToken = hqLogin.body.accessToken;

    const reg = await request(app)
      .post('/auth/register')
      .send({ name: 'Supplier Detail Tester', phone: contractorPhone, password: 'password123' });
    contractorToken = reg.body.accessToken;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE phone = $1', [contractorPhone]);
  });

  // Security regression (this phase): this route used to have NO auth middleware at all — any
  // unauthenticated caller who obtained a supplier UUID (e.g. via a contractor-facing order's
  // assignedSupplierId) could fetch that supplier's raw phone number with zero authentication.
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/suppliers/' + supplierId);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MISSING_TOKEN');
  });

  // A contractor is intentionally NOT forbidden here (unlike the HQ-only list endpoint above) —
  // src/app/material/[materialId]/index.tsx legitimately needs this for any authenticated
  // contractor to show which supplier fulfills a material they're browsing.
  it('lets an authenticated contractor read a supplier, without exposing its phone number', async () => {
    const res = await request(app).get('/suppliers/' + supplierId).set('Authorization', 'Bearer ' + contractorToken);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(supplierId);
    expect(res.body.name).toBeTruthy();
    expect(res.body.locality).toBeTruthy();
    expect(res.body).not.toHaveProperty('phone');
  });

  // HQ gets the same privacy-minimal shape from this specific route too — HQ's own operational
  // need for a supplier's phone number is served by the separate, already-HQ-only GET /suppliers
  // list endpoint (see the describe block above), not by this per-supplier lookup.
  it('also withholds the phone number from HQ on this route', async () => {
    const res = await request(app).get('/suppliers/' + supplierId).set('Authorization', 'Bearer ' + hqToken);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('phone');
  });

  it('returns 400 for a malformed id', async () => {
    const res = await request(app).get('/suppliers/does-not-exist').set('Authorization', 'Bearer ' + contractorToken);
    expect(res.status).toBe(400);
  });

  it('returns 404 for a well-formed but nonexistent id', async () => {
    const res = await request(app)
      .get('/suppliers/00000000-0000-0000-0000-000000000000')
      .set('Authorization', 'Bearer ' + contractorToken);
    expect(res.status).toBe(404);
  });
});

afterAll(async () => {
  await pool.end();
});
