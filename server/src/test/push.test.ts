import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { pool } from '../config/db';
import { sendPushToHqDevices } from '../modules/push/push.service';
import { deleteUserByPhone, uniquePhone } from './db-helpers';

describe('POST /push/register and /push/unregister', () => {
  const phoneA = uniquePhone();
  const phoneB = uniquePhone();
  const password = 'password123';
  let tokenA: string;
  let tokenB: string;
  let userAId: string;

  beforeAll(async () => {
    const regA = await request(app).post('/auth/register').send({ name: 'Push Test A', phone: phoneA, password });
    tokenA = regA.body.accessToken;
    userAId = regA.body.user.id;

    const regB = await request(app).post('/auth/register').send({ name: 'Push Test B', phone: phoneB, password });
    tokenB = regB.body.accessToken;
  });

  afterAll(async () => {
    await deleteUserByPhone(phoneA);
    await deleteUserByPhone(phoneB);
  });

  it('rejects unauthenticated register with 401', async () => {
    const res = await request(app).post('/push/register').send({ expoPushToken: 'ExponentPushToken[x]', platform: 'ios' });
    expect(res.status).toBe(401);
  });

  it('rejects invalid body with 400', async () => {
    const res = await request(app)
      .post('/push/register')
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ expoPushToken: 'ExponentPushToken[x]' });
    expect(res.status).toBe(400);
  });

  it('registers a token for the authenticated user', async () => {
    const res = await request(app)
      .post('/push/register')
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ expoPushToken: 'ExponentPushToken[shared]', platform: 'ios' });
    expect(res.status).toBe(204);

    const row = await pool.query('SELECT user_id, platform FROM push_tokens WHERE user_id = $1', [userAId]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].platform).toBe('ios');
  });

  it('upserts on re-registration instead of erroring or duplicating', async () => {
    const res = await request(app)
      .post('/push/register')
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ expoPushToken: 'ExponentPushToken[shared]', platform: 'android' });
    expect(res.status).toBe(204);

    const row = await pool.query('SELECT platform FROM push_tokens WHERE user_id = $1', [userAId]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].platform).toBe('android');
  });

  it('scopes unregister to the caller — cannot remove another user\'s token', async () => {
    await request(app)
      .post('/push/register')
      .set('Authorization', 'Bearer ' + tokenB)
      .send({ expoPushToken: 'ExponentPushToken[shared]', platform: 'ios' });

    await request(app)
      .post('/push/unregister')
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ expoPushToken: 'ExponentPushToken[shared]' });

    const rowA = await pool.query('SELECT 1 FROM push_tokens WHERE user_id = $1', [userAId]);
    expect(rowA.rows).toHaveLength(0);

    const rowB = await pool.query(
      'SELECT 1 FROM push_tokens pt JOIN users u ON u.id = pt.user_id WHERE u.phone = $1',
      [phoneB],
    );
    expect(rowB.rows).toHaveLength(1);
  });
});

describe('Order creation with a registered HQ push token', () => {
  const contractorPhone = uniquePhone();
  const password = 'password123';
  let contractorToken: string;
  let siteId: string;
  let materialId: string;
  let minOrderQuantity: number;
  let hqUserId: string;
  let createdOrderId: string | undefined;

  beforeAll(async () => {
    const reg = await request(app)
      .post('/auth/register')
      .send({ name: 'Push Order Contractor', phone: contractorPhone, password });
    contractorToken = reg.body.accessToken;

    const site = await pool.query(
      'INSERT INTO construction_sites (contractor_id, label, address) VALUES ($1, $2, $3) RETURNING id',
      [reg.body.user.id, 'Push Test Site', 'Push Test Address'],
    );
    siteId = site.rows[0].id;

    const materials = await request(app).get('/materials');
    const inStock = materials.body.find((m: any) => m.stockStatus === 'in_stock');
    materialId = inStock.id;
    minOrderQuantity = inStock.minOrderQuantity;

    const hqLogin = await request(app).post('/auth/login').send({ phone: '+91 90000 00001', password: 'password123' });
    hqUserId = hqLogin.body.user.id;

    await request(app)
      .post('/push/register')
      .set('Authorization', 'Bearer ' + hqLogin.body.accessToken)
      .send({ expoPushToken: 'ExponentPushToken[hq-order-test]', platform: 'ios' });
  });

  afterAll(async () => {
    if (createdOrderId) await pool.query('DELETE FROM orders WHERE id = $1', [createdOrderId]);
    await pool.query('DELETE FROM push_tokens WHERE user_id = $1', [hqUserId]);
    await deleteUserByPhone(contractorPhone);
  });

  it('still returns 201 even though the push send necessarily fails against the disabled test endpoint', async () => {
    const res = await request(app)
      .post('/orders')
      .set('Authorization', 'Bearer ' + contractorToken)
      .send({ materialId, siteId, quantity: minOrderQuantity });
    expect(res.status).toBe(201);
    createdOrderId = res.body.id;
  });
});

describe('sendPushToHqDevices response inspection', () => {
  const hqPhone = '+91 90000 00001';
  const testToken = 'ExponentPushToken[response-inspection-test]';
  let hqUserId: string;

  beforeAll(async () => {
    const hqLogin = await request(app).post('/auth/login').send({ phone: hqPhone, password: 'password123' });
    hqUserId = hqLogin.body.user.id;
    await request(app)
      .post('/push/register')
      .set('Authorization', 'Bearer ' + hqLogin.body.accessToken)
      .send({ expoPushToken: testToken, platform: 'ios' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await pool.query('DELETE FROM push_tokens WHERE user_id = $1 AND expo_push_token = $2', [hqUserId, testToken]);
  });

  const order = {
    id: '00000000-0000-0000-0000-000000000001',
    site_label: 'Test Site',
    items: [{ material_name: 'Test Material', unit: 'bag', quantity: 1 }],
  };

  it('never throws when Expo returns a non-ok HTTP status', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
    );
    await expect(sendPushToHqDevices(order)).resolves.toBeUndefined();
  });

  it('never throws when Expo returns a 200 with a per-token error ticket', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ status: 'error', message: 'DeviceNotRegistered', details: { error: 'DeviceNotRegistered' } }],
        }),
        { status: 200 },
      ),
    );
    await expect(sendPushToHqDevices(order)).resolves.toBeUndefined();
  });

  it('never throws when the fetch call itself rejects', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
    await expect(sendPushToHqDevices(order)).resolves.toBeUndefined();
  });
});

afterAll(async () => {
  await pool.end();
});
