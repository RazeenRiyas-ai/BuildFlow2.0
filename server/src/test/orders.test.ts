import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { pool } from '../config/db';
import { ORDER_TRANSITIONS, transitionOrderStatus } from '../modules/orders/orders.service';
import { deleteUserByPhone, uniquePhone } from './db-helpers';

describe('ORDER_TRANSITIONS', () => {
  it('only allows the documented forward transitions', () => {
    expect(ORDER_TRANSITIONS.requested).toEqual(['supplier_contacted', 'cancelled']);
    expect(ORDER_TRANSITIONS.supplier_contacted).toEqual(['supplier_confirmed', 'supplier_rejected', 'cancelled']);
    expect(ORDER_TRANSITIONS.supplier_confirmed).toEqual(['driver_assigned', 'cancelled']);
    expect(ORDER_TRANSITIONS.supplier_rejected).toEqual(['supplier_contacted', 'cancelled']);
    expect(ORDER_TRANSITIONS.driver_assigned).toEqual(['out_for_delivery', 'cancelled']);
    expect(ORDER_TRANSITIONS.out_for_delivery).toEqual(['delivered']);
    expect(ORDER_TRANSITIONS.delivered).toEqual([]);
    expect(ORDER_TRANSITIONS.cancelled).toEqual([]);
  });
});

describe('Orders', () => {
  const phoneA = uniquePhone();
  const phoneB = uniquePhone();
  const password = 'password123';
  let tokenA: string;
  let tokenB: string;
  let contractorAId: string;
  let siteAId: string;
  let siteBId: string;
  let inStockMaterialId: string;
  let outOfStockMaterialId: string;
  let minOrderQuantity: number;
  let hqToken: string;

  beforeAll(async () => {
    const regA = await request(app).post('/auth/register').send({ name: 'Order Contractor A', phone: phoneA, password: password });
    tokenA = regA.body.accessToken;
    contractorAId = regA.body.user.id;

    const regB = await request(app).post('/auth/register').send({ name: 'Order Contractor B', phone: phoneB, password: password });
    tokenB = regB.body.accessToken;
    const contractorBId = regB.body.user.id;

    const siteInsertSql = 'INSERT INTO construction_sites (contractor_id, label, address) VALUES ($1, $2, $3) RETURNING id';
    const siteA = await pool.query(siteInsertSql, [contractorAId, 'Order Test Site A', 'Address A']);
    siteAId = siteA.rows[0].id;
    const siteB = await pool.query(siteInsertSql, [contractorBId, 'Order Test Site B', 'Address B']);
    siteBId = siteB.rows[0].id;

    const materials = await request(app).get('/materials');
    const inStock = materials.body.find((m: any) => m.stockStatus === 'in_stock');
    const outOfStock = materials.body.find((m: any) => m.stockStatus === 'out_of_stock');
    inStockMaterialId = inStock.id;
    minOrderQuantity = inStock.minOrderQuantity;
    outOfStockMaterialId = outOfStock.id;

    const hqLogin = await request(app).post('/auth/login').send({ phone: '+91 90000 00001', password: 'password123' });
    hqToken = hqLogin.body.accessToken;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM orders WHERE site_id = $1 OR site_id = $2', [siteAId, siteBId]);
    await pool.query('DELETE FROM construction_sites WHERE id = $1 OR id = $2', [siteAId, siteBId]);
    await deleteUserByPhone(phoneA);
    await deleteUserByPhone(phoneB);
  });

  it('rejects unauthenticated create with 401', async () => {
    const res = await request(app).post('/orders').send({ materialId: inStockMaterialId, siteId: siteAId, quantity: minOrderQuantity });
    expect(res.status).toBe(401);
  });

  it('rejects HQ role with 403', async () => {
    const res = await request(app).post('/orders').set('Authorization', 'Bearer ' + hqToken).send({ materialId: inStockMaterialId, siteId: siteAId, quantity: minOrderQuantity });
    expect(res.status).toBe(403);
  });

  it('rejects an unknown material with 404', async () => {
    const res = await request(app).post('/orders').set('Authorization', 'Bearer ' + tokenA).send({ materialId: '00000000-0000-0000-0000-000000000000', siteId: siteAId, quantity: minOrderQuantity });
    expect(res.status).toBe(404);
  });

  it('rejects ordering to a site owned by another contractor', async () => {
    const res = await request(app).post('/orders').set('Authorization', 'Bearer ' + tokenA).send({ materialId: inStockMaterialId, siteId: siteBId, quantity: minOrderQuantity });
    expect(res.status).toBe(404);
  });

  it('rejects an out-of-stock material with 409', async () => {
    const res = await request(app).post('/orders').set('Authorization', 'Bearer ' + tokenA).send({ materialId: outOfStockMaterialId, siteId: siteAId, quantity: 1 });
    expect(res.status).toBe(409);
  });

  it('rejects a quantity below the minimum with 400', async () => {
    const res = await request(app).post('/orders').set('Authorization', 'Bearer ' + tokenA).send({ materialId: inStockMaterialId, siteId: siteAId, quantity: 0.1 });
    expect(res.status).toBe(400);
  });

  it('ignores tampering fields and creates a normal requested order', async () => {
    const res = await request(app)
      .post('/orders')
      .set('Authorization', 'Bearer ' + tokenA)
      .send({
        materialId: inStockMaterialId,
        siteId: siteAId,
        quantity: minOrderQuantity,
        note: 'leave at gate',
        status: 'delivered',
        contractorId: 'should-be-ignored',
        assignedSupplierId: 'should-be-ignored',
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('requested');
    expect(res.body.contractorNote).toBe('leave at gate');
  });

  describe('with an existing order', () => {
    let orderId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post('/orders')
        .set('Authorization', 'Bearer ' + tokenA)
        .send({ materialId: inStockMaterialId, siteId: siteAId, quantity: minOrderQuantity });
      orderId = res.body.id;
    });

    it('lists only the owning contractor own orders', async () => {
      const resA = await request(app).get('/orders').set('Authorization', 'Bearer ' + tokenA);
      expect(resA.status).toBe(200);
      expect(resA.body.some((o: any) => o.id === orderId)).toBe(true);

      const resB = await request(app).get('/orders').set('Authorization', 'Bearer ' + tokenB);
      expect(resB.status).toBe(200);
      expect(resB.body.some((o: any) => o.id === orderId)).toBe(false);
    });

    it('rejects fetching another contractor order with 404', async () => {
      const res = await request(app).get('/orders/' + orderId).set('Authorization', 'Bearer ' + tokenB);
      expect(res.status).toBe(404);
    });

    it('returns full detail including items and history for the owner', async () => {
      const res = await request(app).get('/orders/' + orderId).set('Authorization', 'Bearer ' + tokenA);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.history).toHaveLength(1);
      expect(res.body.history[0].toStatus).toBe('requested');
    });

    it('rejects cancel from another contractor with 404', async () => {
      const res = await request(app).patch('/orders/' + orderId + '/cancel').set('Authorization', 'Bearer ' + tokenB);
      expect(res.status).toBe(404);
    });

    it('cancels a requested order for its owner', async () => {
      const res = await request(app).patch('/orders/' + orderId + '/cancel').set('Authorization', 'Bearer ' + tokenA);
      expect(res.status).toBe(204);

      const check = await request(app).get('/orders/' + orderId).set('Authorization', 'Bearer ' + tokenA);
      expect(check.body.status).toBe('cancelled');
    });

    it('rejects cancelling an already-cancelled order with 409', async () => {
      const res = await request(app).patch('/orders/' + orderId + '/cancel').set('Authorization', 'Bearer ' + tokenA);
      expect(res.status).toBe(409);
    });

    it('rejects an invalid transition via transitionOrderStatus directly', async () => {
      await expect(transitionOrderStatus(orderId, 'out_for_delivery', contractorAId)).rejects.toThrow();
    });
  });

  describe('full operational happy path (direct service calls, HQ endpoints not built yet)', () => {
    let orderId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post('/orders')
        .set('Authorization', 'Bearer ' + tokenA)
        .send({ materialId: inStockMaterialId, siteId: siteAId, quantity: minOrderQuantity });
      orderId = res.body.id;
    });

    it('walks through the full operational flow including a supplier-rejection retry', async () => {
      await transitionOrderStatus(orderId, 'supplier_contacted', contractorAId);
      await transitionOrderStatus(orderId, 'supplier_rejected', contractorAId);
      await transitionOrderStatus(orderId, 'supplier_contacted', contractorAId);
      await transitionOrderStatus(orderId, 'supplier_confirmed', contractorAId);
      await transitionOrderStatus(orderId, 'driver_assigned', contractorAId);
      await transitionOrderStatus(orderId, 'out_for_delivery', contractorAId);
      await transitionOrderStatus(orderId, 'delivered', contractorAId);

      const res = await request(app).get('/orders/' + orderId).set('Authorization', 'Bearer ' + tokenA);
      expect(res.body.status).toBe('delivered');
      expect(res.body.history.length).toBe(8);
    });

    it('rejects any transition once delivered', async () => {
      await expect(transitionOrderStatus(orderId, 'cancelled', contractorAId)).rejects.toThrow();
    });
  });
});


afterAll(async () => {
  await pool.end();
});
