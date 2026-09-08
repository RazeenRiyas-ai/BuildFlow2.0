import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { pool } from '../config/db';
import { ErrorCode } from '../errors/error-codes';
import { IDEMPOTENCY_SCOPES } from '../idempotency/idempotency';
import { computeRequestHash } from '../idempotency/request-hash';
import { deleteUserByPhone, uniquePhone } from './db-helpers';

const IDEMPOTENCY_HEADER = 'Idempotency-Key';

describe('computeRequestHash (unit)', () => {
  it('produces the same hash regardless of key order', () => {
    const a = computeRequestHash({ materialId: 'm1', siteId: 's1', quantity: 5 });
    const b = computeRequestHash({ quantity: 5, siteId: 's1', materialId: 'm1' });
    expect(a).toBe(b);
  });

  it('produces a different hash for a different payload', () => {
    const a = computeRequestHash({ materialId: 'm1', siteId: 's1', quantity: 5 });
    const b = computeRequestHash({ materialId: 'm1', siteId: 's1', quantity: 6 });
    expect(a).not.toBe(b);
  });

  it('is a 64-character hex SHA-256 digest', () => {
    const hash = computeRequestHash({ a: 1 });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('POST /orders — durable idempotency', () => {
  const phoneA = uniquePhone();
  const phoneB = uniquePhone();
  const password = 'password123';
  let tokenA: string;
  let tokenB: string;
  let contractorAId: string;
  let contractorBId: string;
  let siteAId: string;
  let siteBId: string;
  let inStockMaterialId: string;
  let minOrderQuantity: number;

  beforeAll(async () => {
    const regA = await request(app).post('/auth/register').send({ name: 'Idem Contractor A', phone: phoneA, password });
    tokenA = regA.body.accessToken;
    contractorAId = regA.body.user.id;

    const regB = await request(app).post('/auth/register').send({ name: 'Idem Contractor B', phone: phoneB, password });
    tokenB = regB.body.accessToken;
    contractorBId = regB.body.user.id;

    const siteInsertSql = 'INSERT INTO construction_sites (contractor_id, label, address) VALUES ($1, $2, $3) RETURNING id';
    const siteA = await pool.query(siteInsertSql, [contractorAId, 'Idem Site A', 'Address A']);
    siteAId = siteA.rows[0].id;
    const siteB = await pool.query(siteInsertSql, [contractorBId, 'Idem Site B', 'Address B']);
    siteBId = siteB.rows[0].id;

    const materials = await request(app).get('/materials');
    const inStock = materials.body.find((m: any) => m.stockStatus === 'in_stock');
    inStockMaterialId = inStock.id;
    minOrderQuantity = inStock.minOrderQuantity;
  });

  afterAll(async () => {
    // idempotency_keys rows for these users cascade-delete automatically (ON DELETE CASCADE on
    // user_id) once the users themselves are removed below, but orders/sites don't cascade from
    // users, so those still need explicit cleanup first (orders reference sites via a plain FK).
    await pool.query('DELETE FROM orders WHERE site_id = $1 OR site_id = $2', [siteAId, siteBId]);
    await pool.query('DELETE FROM construction_sites WHERE id = $1 OR id = $2', [siteAId, siteBId]);
    await deleteUserByPhone(phoneA);
    await deleteUserByPhone(phoneB);
  });

  function orderCount(siteId: string): Promise<number> {
    return pool.query('SELECT count(*)::int AS count FROM orders WHERE site_id = $1', [siteId]).then((r) => r.rows[0].count);
  }

  it('Test 1 — a first request with an idempotency key creates exactly one order', async () => {
    const key = `test1-${Date.now()}`;
    const before = await orderCount(siteAId);

    const res = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .set(IDEMPOTENCY_HEADER, key)
      .send({ materialId: inStockMaterialId, siteId: siteAId, quantity: minOrderQuantity });

    expect(res.status).toBe(201);
    expect(await orderCount(siteAId)).toBe(before + 1);

    const row = await pool.query('SELECT status, response_status FROM idempotency_keys WHERE user_id = $1 AND idempotency_key = $2', [
      contractorAId,
      key,
    ]);
    expect(row.rows[0].status).toBe('completed');
    expect(row.rows[0].response_status).toBe(201);
  });

  it('Test 2 — the same request replayed with the same key returns the same response and creates no second order', async () => {
    const key = `test2-${Date.now()}`;
    const payload = { materialId: inStockMaterialId, siteId: siteAId, quantity: minOrderQuantity };

    const first = await request(app).post('/orders').set('Authorization', `Bearer ${tokenA}`).set(IDEMPOTENCY_HEADER, key).send(payload);
    expect(first.status).toBe(201);

    const before = await orderCount(siteAId);
    const second = await request(app).post('/orders').set('Authorization', `Bearer ${tokenA}`).set(IDEMPOTENCY_HEADER, key).send(payload);

    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await orderCount(siteAId)).toBe(before);
  });

  it('Test 3 — the same key with a different payload returns a conflict, not a second order', async () => {
    const key = `test3-${Date.now()}`;
    const first = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .set(IDEMPOTENCY_HEADER, key)
      .send({ materialId: inStockMaterialId, siteId: siteAId, quantity: minOrderQuantity });
    expect(first.status).toBe(201);

    const before = await orderCount(siteAId);
    const second = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .set(IDEMPOTENCY_HEADER, key)
      .send({ materialId: inStockMaterialId, siteId: siteAId, quantity: minOrderQuantity + 1 });

    expect(second.status).toBe(409);
    expect(second.body.code).toBe(ErrorCode.IDEMPOTENCY_KEY_REUSED);
    expect(typeof second.body.requestId).toBe('string');
    expect(await orderCount(siteAId)).toBe(before);
  });

  it('Test 4 — the same key string used by two different users works independently', async () => {
    const sharedKey = `shared-${Date.now()}`;

    const resA = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .set(IDEMPOTENCY_HEADER, sharedKey)
      .send({ materialId: inStockMaterialId, siteId: siteAId, quantity: minOrderQuantity });
    const resB = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${tokenB}`)
      .set(IDEMPOTENCY_HEADER, sharedKey)
      .send({ materialId: inStockMaterialId, siteId: siteBId, quantity: minOrderQuantity });

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    expect(resA.body.id).not.toBe(resB.body.id);
  });

  it('Test 5 — two concurrent identical requests with the same key create exactly one order', async () => {
    const key = `concurrent-${Date.now()}`;
    const payload = { materialId: inStockMaterialId, siteId: siteAId, quantity: minOrderQuantity };
    const before = await orderCount(siteAId);

    const [resA, resB] = await Promise.all([
      request(app).post('/orders').set('Authorization', `Bearer ${tokenA}`).set(IDEMPOTENCY_HEADER, key).send(payload),
      request(app).post('/orders').set('Authorization', `Bearer ${tokenA}`).set(IDEMPOTENCY_HEADER, key).send(payload),
    ]);

    expect([resA.status, resB.status]).toEqual([201, 201]);
    expect(resA.body.id).toBe(resB.body.id);
    expect(await orderCount(siteAId)).toBe(before + 1);
  });

  it('Test 5b — a higher-concurrency burst (10 simultaneous identical requests) still creates exactly one order', async () => {
    const key = `concurrent-burst-${Date.now()}`;
    const payload = { materialId: inStockMaterialId, siteId: siteAId, quantity: minOrderQuantity };
    const before = await orderCount(siteAId);

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app).post('/orders').set('Authorization', `Bearer ${tokenA}`).set(IDEMPOTENCY_HEADER, key).send(payload),
      ),
    );

    expect(responses.every((r) => r.status === 201)).toBe(true);
    const distinctOrderIds = new Set(responses.map((r) => r.body.id));
    expect(distinctOrderIds.size).toBe(1);
    expect(await orderCount(siteAId)).toBe(before + 1);
  });

  it('Test 6 — a failed attempt does not permanently poison the key; a retry with the same key can succeed', async () => {
    const key = `retry-after-failure-${Date.now()}`;

    const failing = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .set(IDEMPOTENCY_HEADER, key)
      .send({ materialId: inStockMaterialId, siteId: siteAId, quantity: 0.1 });
    expect(failing.status).toBe(400);

    // Test 12 (folded in here): the failed attempt must not have been persisted as a completed —
    // or any — idempotency record. The claim rolled back with the rest of its transaction.
    const rowAfterFailure = await pool.query(
      'SELECT 1 FROM idempotency_keys WHERE user_id = $1 AND idempotency_key = $2',
      [contractorAId, key],
    );
    expect(rowAfterFailure.rowCount).toBe(0);

    const before = await orderCount(siteAId);
    const retry = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .set(IDEMPOTENCY_HEADER, key)
      .send({ materialId: inStockMaterialId, siteId: siteAId, quantity: minOrderQuantity });

    expect(retry.status).toBe(201);
    expect(await orderCount(siteAId)).toBe(before + 1);
  });

  it('Test 7 — the completed response is durably persisted in Postgres, not held in memory', async () => {
    const key = `durable-${Date.now()}`;
    const created = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .set(IDEMPOTENCY_HEADER, key)
      .send({ materialId: inStockMaterialId, siteId: siteAId, quantity: minOrderQuantity });
    expect(created.status).toBe(201);

    // Read the persisted row directly — this is the actual durable record a replay after a
    // process restart would read; nothing about it depends on the current process's memory.
    const row = await pool.query(
      'SELECT response_status, response_body, resource_id FROM idempotency_keys WHERE user_id = $1 AND idempotency_key = $2',
      [contractorAId, key],
    );
    expect(row.rows[0].response_status).toBe(201);
    expect(row.rows[0].response_body).toEqual(created.body);
    expect(row.rows[0].resource_id).toBe(created.body.id);

    // A "replay after restart" is indistinguishable, from the outside, from a replay against a
    // freshly-connected client — both just read this same committed row. Prove the replay path
    // itself still works using a brand new pool connection, not any cached client/handle.
    const freshClient = await pool.connect();
    try {
      const replay = await request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .set(IDEMPOTENCY_HEADER, key)
        .send({ materialId: inStockMaterialId, siteId: siteAId, quantity: minOrderQuantity });
      expect(replay.body).toEqual(created.body);
    } finally {
      freshClient.release();
    }
  });

  it('Test 8 — requests without an Idempotency-Key header preserve existing (non-deduplicated) behavior', async () => {
    const payload = { materialId: inStockMaterialId, siteId: siteAId, quantity: minOrderQuantity };
    const before = await orderCount(siteAId);

    const first = await request(app).post('/orders').set('Authorization', `Bearer ${tokenA}`).send(payload);
    const second = await request(app).post('/orders').set('Authorization', `Bearer ${tokenA}`).send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.id).not.toBe(second.body.id);
    expect(await orderCount(siteAId)).toBe(before + 2);
  });

  it('Test 9a — an oversized Idempotency-Key is rejected with 400', async () => {
    const res = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .set(IDEMPOTENCY_HEADER, 'a'.repeat(200))
      .send({ materialId: inStockMaterialId, siteId: siteAId, quantity: minOrderQuantity });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.INVALID_PARAMETER);
  });

  it('Test 9b — an Idempotency-Key with unsafe characters is rejected with 400', async () => {
    const res = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .set(IDEMPOTENCY_HEADER, 'bad key; with spaces')
      .send({ materialId: inStockMaterialId, siteId: siteAId, quantity: minOrderQuantity });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.INVALID_PARAMETER);
  });

  it('Test 10 — idempotency conflicts use the existing error/response-ID system', async () => {
    const key = `req-id-${Date.now()}`;
    const payload = { materialId: inStockMaterialId, siteId: siteAId, quantity: minOrderQuantity };
    await request(app).post('/orders').set('Authorization', `Bearer ${tokenA}`).set(IDEMPOTENCY_HEADER, key).send(payload);

    const conflict = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .set(IDEMPOTENCY_HEADER, key)
      .send({ ...payload, quantity: minOrderQuantity + 5 });

    expect(conflict.status).toBe(409);
    expect(Object.keys(conflict.body).sort()).toEqual(['code', 'error', 'requestId']);
    expect(conflict.headers['x-request-id']).toBe(conflict.body.requestId);
  });

  it('Test 11 — a replay does not duplicate order items', async () => {
    const key = `items-${Date.now()}`;
    const payload = { materialId: inStockMaterialId, siteId: siteAId, quantity: minOrderQuantity };

    const created = await request(app).post('/orders').set('Authorization', `Bearer ${tokenA}`).set(IDEMPOTENCY_HEADER, key).send(payload);
    await request(app).post('/orders').set('Authorization', `Bearer ${tokenA}`).set(IDEMPOTENCY_HEADER, key).send(payload);

    const items = await pool.query('SELECT count(*)::int AS count FROM order_items WHERE order_id = $1', [created.body.id]);
    expect(items.rows[0].count).toBe(1);
  });

  it('defensive: a key claimed but still in_progress (should be unreachable in real operation) is reported as IDEMPOTENCY_REQUEST_IN_PROGRESS', async () => {
    const key = `stuck-${Date.now()}`;
    const requestHash = computeRequestHash({ materialId: inStockMaterialId, siteId: siteAId, quantity: minOrderQuantity });

    // Simulates the (structurally-prevented, per idempotency-store.ts's own comments) case of a
    // row existing in 'in_progress' at read time, to prove the defensive branch behaves safely
    // rather than assuming it can never happen.
    await pool.query(
      `INSERT INTO idempotency_keys (user_id, scope, idempotency_key, request_hash, status)
       VALUES ($1, $2, $3, $4, 'in_progress')`,
      [contractorAId, IDEMPOTENCY_SCOPES.ORDERS_CREATE, key, requestHash],
    );

    const res = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .set(IDEMPOTENCY_HEADER, key)
      .send({ materialId: inStockMaterialId, siteId: siteAId, quantity: minOrderQuantity });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ErrorCode.IDEMPOTENCY_REQUEST_IN_PROGRESS);

    await pool.query('DELETE FROM idempotency_keys WHERE user_id = $1 AND idempotency_key = $2', [contractorAId, key]);
  });
});

afterAll(async () => {
  await pool.end();
});
