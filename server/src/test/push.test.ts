import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { pool } from '../config/db';
import { sendPushToHqDevices, sendOrderStatusPushToContractor } from '../modules/push/push.service';
import { createContractorSession, deleteUserByPhone, signTestAccessToken, uniquePhone } from './db-helpers';

/** Polls `check` until it returns true or `timeoutMs` elapses — used only for the fire-and-forget
 * contractor push send in transitionOrderStatus, which the HTTP response does not wait for (by
 * design: push sending must never delay or block the request that triggered it). Never used to
 * paper over genuine flakiness elsewhere. */
async function waitFor(check: () => boolean, timeoutMs = 1000, intervalMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition never became true within ' + timeoutMs + 'ms');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

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
    const before = await pool.query('SELECT last_seen_at FROM push_tokens WHERE user_id = $1', [userAId]);
    const lastSeenBefore = before.rows[0].last_seen_at;

    await new Promise((resolve) => setTimeout(resolve, 20));

    const res = await request(app)
      .post('/push/register')
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ expoPushToken: 'ExponentPushToken[shared]', platform: 'android' });
    expect(res.status).toBe(204);

    const row = await pool.query('SELECT platform, last_seen_at FROM push_tokens WHERE user_id = $1', [userAId]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].platform).toBe('android');
    expect(new Date(row.rows[0].last_seen_at).getTime()).toBeGreaterThan(new Date(lastSeenBefore).getTime());
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
      .send({ siteId, items: [{ materialId, quantity: minOrderQuantity }] });
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

describe('sendOrderStatusPushToContractor', () => {
  const phoneA = uniquePhone();
  const phoneB = uniquePhone();
  const password = 'password123';
  let contractorAId: string;
  let contractorBId: string;
  const tokenA1 = 'ExponentPushToken[contractor-a-device-1]';
  const tokenA2 = 'ExponentPushToken[contractor-a-device-2]';
  const tokenB1 = 'ExponentPushToken[contractor-b-device-1]';

  beforeAll(async () => {
    const sessionA = await createContractorSession('Contractor A', phoneA);
    contractorAId = sessionA.userId;
    const sessionB = await createContractorSession('Contractor B', phoneB);
    contractorBId = sessionB.userId;

    for (const token of [tokenA1, tokenA2]) {
      await request(app).post('/push/register').set('Authorization', 'Bearer ' + sessionA.accessToken).send({ expoPushToken: token, platform: 'ios' });
    }
    await request(app).post('/push/register').set('Authorization', 'Bearer ' + sessionB.accessToken).send({ expoPushToken: tokenB1, platform: 'android' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await deleteUserByPhone(phoneA);
    await deleteUserByPhone(phoneB);
  });

  it('targets exactly the named contractor’s device(s) — every registered device, never another contractor’s', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ status: 'ok' }, { status: 'ok' }] }), { status: 200 }));

    await sendOrderStatusPushToContractor({
      orderId: '00000000-0000-0000-0000-0000000000aa',
      contractorId: contractorAId,
      status: 'supplier_confirmed',
      itemSummary: 'OPC Cement',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(new Set(sentBody.to)).toEqual(new Set([tokenA1, tokenA2]));
    expect(sentBody.to).not.toContain(tokenB1);
  });

  it('every supported status has distinct, professional copy and a correctly-shaped payload', async () => {
    const cases: { status: string; expectTitle: string; expectBodyContains: string }[] = [
      { status: 'supplier_contacted', expectTitle: 'Order Update', expectBodyContains: 'supplier' },
      { status: 'supplier_confirmed', expectTitle: 'Supplier Confirmed', expectBodyContains: 'confirmed' },
      { status: 'supplier_rejected', expectTitle: 'Finding Another Supplier', expectBodyContains: 'another supplier' },
      { status: 'driver_assigned', expectTitle: 'Driver Assigned', expectBodyContains: 'driver' },
      { status: 'out_for_delivery', expectTitle: 'Out for Delivery', expectBodyContains: 'on the way' },
      { status: 'delivered', expectTitle: 'Order Delivered', expectBodyContains: 'delivered' },
      { status: 'cancelled', expectTitle: 'Order Cancelled', expectBodyContains: 'cancelled' },
    ];

    for (const testCase of cases) {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ status: 'ok' }] }), { status: 200 }));

      const orderId = '00000000-0000-0000-0000-0000000000bb';
      // eslint-disable-next-line no-await-in-loop
      await sendOrderStatusPushToContractor({
        orderId,
        contractorId: contractorBId,
        status: testCase.status as any,
        itemSummary: 'TMT Steel Bar',
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const sentBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
      expect(sentBody.title).toBe(testCase.expectTitle);
      expect(sentBody.body.toLowerCase()).toContain(testCase.expectBodyContains.toLowerCase());
      expect(sentBody.body).toContain('TMT Steel Bar');
      expect(sentBody.data).toEqual({ type: 'order_status_changed', orderId, status: testCase.status });

      vi.restoreAllMocks();
    }
  });

  it('never pushes for "requested" — the contractor is already looking at the app when they submit', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    await sendOrderStatusPushToContractor({
      orderId: '00000000-0000-0000-0000-0000000000cc',
      contractorId: contractorAId,
      status: 'requested' as any,
      itemSummary: 'Sand',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('deletes only the specific token Expo reports as DeviceNotRegistered, leaving other devices/users untouched', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } },
            { status: 'ok' },
          ],
        }),
        { status: 200 },
      ),
    );

    await sendOrderStatusPushToContractor({
      orderId: '00000000-0000-0000-0000-0000000000dd',
      contractorId: contractorAId,
      status: 'delivered',
      itemSummary: 'Bricks',
    });

    // Order of tokens in the `to` array matches insertion order (tokenA1 registered first), so the
    // first ticket (the error one) corresponds to tokenA1.
    const remaining = await pool.query('SELECT expo_push_token FROM push_tokens WHERE user_id = $1', [contractorAId]);
    const remainingTokens = remaining.rows.map((r) => r.expo_push_token);
    expect(remainingTokens).not.toContain(tokenA1);
    expect(remainingTokens).toContain(tokenA2);
    // Deliberately not re-registering tokenA1 — no later test in this suite depends on contractor A
    // having both devices again, and afterAll deletes this whole user regardless.
  });

  it('leaves the token in place for a non-DeviceNotRegistered ticket error (a temporary/message-shaped failure, not proof the device is gone)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ status: 'error', message: 'rate limited', details: { error: 'MessageRateExceeded' } }] }), {
        status: 200,
      }),
    );

    await sendOrderStatusPushToContractor({
      orderId: '00000000-0000-0000-0000-0000000000ee',
      contractorId: contractorBId,
      status: 'delivered',
      itemSummary: 'Bricks',
    });

    const remaining = await pool.query('SELECT 1 FROM push_tokens WHERE user_id = $1 AND expo_push_token = $2', [contractorBId, tokenB1]);
    expect(remaining.rows).toHaveLength(1);
  });

  it('leaves tokens in place when the fetch call itself fails outright (network/provider down)', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(
      sendOrderStatusPushToContractor({
        orderId: '00000000-0000-0000-0000-0000000000ff',
        contractorId: contractorBId,
        status: 'delivered',
        itemSummary: 'Bricks',
      }),
    ).resolves.toBeUndefined();

    const remaining = await pool.query('SELECT 1 FROM push_tokens WHERE user_id = $1 AND expo_push_token = $2', [contractorBId, tokenB1]);
    expect(remaining.rows).toHaveLength(1);
  });
});

describe('contractor order-status push — end-to-end wiring and isolation', () => {
  const contractorAPhone = uniquePhone();
  const contractorBPhone = uniquePhone();
  const password = 'password123';
  let contractorAToken: string;
  let contractorBToken: string;
  let hqToken: string;
  let siteAId: string;
  let siteBId: string;
  let materialId: string;
  let minOrderQuantity: number;
  const pushTokenA = 'ExponentPushToken[e2e-contractor-a]';
  const pushTokenB = 'ExponentPushToken[e2e-contractor-b]';
  const pushTokenHq = 'ExponentPushToken[e2e-hq]';
  let hqUserId: string;

  beforeAll(async () => {
    const sessionA = await createContractorSession('E2E Contractor A', contractorAPhone);
    contractorAToken = sessionA.accessToken;
    const siteA = await pool.query('INSERT INTO construction_sites (contractor_id, label, address) VALUES ($1, $2, $3) RETURNING id', [
      sessionA.userId,
      'E2E Site A',
      'E2E Address A',
    ]);
    siteAId = siteA.rows[0].id;
    await request(app).post('/push/register').set('Authorization', 'Bearer ' + contractorAToken).send({ expoPushToken: pushTokenA, platform: 'ios' });

    const sessionB = await createContractorSession('E2E Contractor B', contractorBPhone);
    contractorBToken = sessionB.accessToken;
    const siteB = await pool.query('INSERT INTO construction_sites (contractor_id, label, address) VALUES ($1, $2, $3) RETURNING id', [
      sessionB.userId,
      'E2E Site B',
      'E2E Address B',
    ]);
    siteBId = siteB.rows[0].id;
    await request(app).post('/push/register').set('Authorization', 'Bearer ' + contractorBToken).send({ expoPushToken: pushTokenB, platform: 'android' });

    const materials = await request(app).get('/materials');
    const inStock = materials.body.find((m: any) => m.stockStatus === 'in_stock');
    materialId = inStock.id;
    minOrderQuantity = inStock.minOrderQuantity;

    const hqUser = await pool.query<{ id: string }>("SELECT id FROM users WHERE phone = '+91 90000 00001'");
    hqUserId = hqUser.rows[0].id;
    hqToken = signTestAccessToken(hqUserId, 'hq_admin');
    await request(app).post('/push/register').set('Authorization', 'Bearer ' + hqToken).send({ expoPushToken: pushTokenHq, platform: 'ios' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await pool.query('DELETE FROM orders WHERE site_id = ANY($1::uuid[])', [[siteAId, siteBId]]);
    await pool.query('DELETE FROM construction_sites WHERE id = ANY($1::uuid[])', [[siteAId, siteBId]]);
    await pool.query('DELETE FROM push_tokens WHERE user_id = $1 AND expo_push_token = $2', [hqUserId, pushTokenHq]);
    await deleteUserByPhone(contractorAPhone);
    await deleteUserByPhone(contractorBPhone);
  });

  it('a real HQ status update pushes only to that order’s own contractor — never the other contractor, never HQ itself', async () => {
    const orderRes = await request(app)
      .post('/orders')
      .set('Authorization', 'Bearer ' + contractorAToken)
      .send({ siteId: siteAId, items: [{ materialId, quantity: minOrderQuantity }] });
    const orderId = orderRes.body.id as string;

    // Order creation fires its own fire-and-forget push to HQ devices (against the deliberately
    // unreachable EXPO_PUSH_URL in .env.test) — let that settle before installing a fetch mock, so
    // it can never race into being captured by the mock this test installs for the *next* push.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const calls: { url: string; body: any }[] = [];
    vi.spyOn(global, 'fetch').mockImplementation(async (url: any, init: any) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
      return new Response(JSON.stringify({ data: [{ status: 'ok' }] }), { status: 200 });
    });

    const statusRes = await request(app)
      .patch('/hq/orders/' + orderId + '/status')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ status: 'supplier_contacted' });
    expect(statusRes.status).toBe(204);

    // The HTTP response above does not wait for the fire-and-forget push (by design — see
    // transitionOrderStatus's own comments) so the actual send happens slightly after it returns.
    await waitFor(() => calls.length > 0);

    expect(calls).toHaveLength(1);
    expect(calls[0].body.to).toEqual([pushTokenA]);
    expect(calls[0].body.to).not.toContain(pushTokenB);
    expect(calls[0].body.to).not.toContain(pushTokenHq);
    expect(calls[0].body.data).toMatchObject({ orderId, status: 'supplier_contacted', type: 'order_status_changed' });
  });

  it('a repeated/duplicate status PATCH to the same target is rejected and never triggers a second push', async () => {
    const orderRes = await request(app)
      .post('/orders')
      .set('Authorization', 'Bearer ' + contractorAToken)
      .send({ siteId: siteAId, items: [{ materialId, quantity: minOrderQuantity }] });
    const orderId = orderRes.body.id as string;

    // See the previous test's identical comment: let order creation's own fire-and-forget HQ push
    // settle before installing a mock, so it can't be miscounted as one of this test's pushes.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const calls: unknown[] = [];
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      calls.push(true);
      return new Response(JSON.stringify({ data: [{ status: 'ok' }] }), { status: 200 });
    });

    const first = await request(app)
      .patch('/hq/orders/' + orderId + '/status')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ status: 'supplier_contacted' });
    expect(first.status).toBe(204);
    await waitFor(() => calls.length >= 1);

    const duplicate = await request(app)
      .patch('/hq/orders/' + orderId + '/status')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ status: 'supplier_contacted' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('ORDER_INVALID_STATUS_TRANSITION');

    // Give any (incorrect) second push a moment it would need to fire, then confirm it never did.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls).toHaveLength(1);
  });

  it('a push delivery failure never fails the order status mutation itself', async () => {
    const orderRes = await request(app)
      .post('/orders')
      .set('Authorization', 'Bearer ' + contractorAToken)
      .send({ siteId: siteAId, items: [{ materialId, quantity: minOrderQuantity }] });
    const orderId = orderRes.body.id as string;

    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Expo is down'));

    const statusRes = await request(app)
      .patch('/hq/orders/' + orderId + '/status')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ status: 'supplier_contacted' });
    expect(statusRes.status).toBe(204);

    const detail = await request(app)
      .get('/hq/orders/' + orderId)
      .set('Authorization', 'Bearer ' + hqToken);
    expect(detail.body.status).toBe('supplier_contacted');
  });

  it('an unauthorized contractor cannot fetch another contractor’s order, even knowing its exact id (as a notification tap would claim)', async () => {
    const orderRes = await request(app)
      .post('/orders')
      .set('Authorization', 'Bearer ' + contractorAToken)
      .send({ siteId: siteAId, items: [{ materialId, quantity: minOrderQuantity }] });
    const orderId = orderRes.body.id as string;

    const res = await request(app)
      .get('/orders/' + orderId)
      .set('Authorization', 'Bearer ' + contractorBToken);
    expect(res.status).toBe(404);

    const ownRes = await request(app)
      .get('/orders/' + orderId)
      .set('Authorization', 'Bearer ' + contractorAToken);
    expect(ownRes.status).toBe(200);
    expect(ownRes.body.id).toBe(orderId);
  });
});

afterAll(async () => {
  await pool.end();
});
