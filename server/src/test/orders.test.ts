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
  let inStockMaterialId2: string;
  let outOfStockMaterialId: string;
  let minOrderQuantity: number;
  let minOrderQuantity2: number;
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
    const inStockMaterials = materials.body.filter((m: any) => m.stockStatus === 'in_stock');
    const outOfStock = materials.body.find((m: any) => m.stockStatus === 'out_of_stock');
    inStockMaterialId = inStockMaterials[0].id;
    minOrderQuantity = inStockMaterials[0].minOrderQuantity;
    inStockMaterialId2 = inStockMaterials[1].id;
    minOrderQuantity2 = inStockMaterials[1].minOrderQuantity;
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
    const res = await request(app).post('/orders').send({ siteId: siteAId, items: [{ materialId: inStockMaterialId, quantity: minOrderQuantity }] });
    expect(res.status).toBe(401);
  });

  it('rejects HQ role with 403', async () => {
    const res = await request(app).post('/orders').set('Authorization', 'Bearer ' + hqToken).send({ siteId: siteAId, items: [{ materialId: inStockMaterialId, quantity: minOrderQuantity }] });
    expect(res.status).toBe(403);
  });

  it('rejects an empty items array with 400', async () => {
    const res = await request(app).post('/orders').set('Authorization', 'Bearer ' + tokenA).send({ siteId: siteAId, items: [] });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown material with 404', async () => {
    const res = await request(app).post('/orders').set('Authorization', 'Bearer ' + tokenA).send({ siteId: siteAId, items: [{ materialId: '00000000-0000-0000-0000-000000000000', quantity: minOrderQuantity }] });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('MATERIAL_NOT_FOUND');
  });

  it('rejects ordering to a site owned by another contractor', async () => {
    const res = await request(app).post('/orders').set('Authorization', 'Bearer ' + tokenA).send({ siteId: siteBId, items: [{ materialId: inStockMaterialId, quantity: minOrderQuantity }] });
    expect(res.status).toBe(404);
  });

  it('rejects an out-of-stock material with 409', async () => {
    const res = await request(app).post('/orders').set('Authorization', 'Bearer ' + tokenA).send({ siteId: siteAId, items: [{ materialId: outOfStockMaterialId, quantity: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MATERIAL_OUT_OF_STOCK');
  });

  it('rejects a quantity below the minimum with 400', async () => {
    const res = await request(app).post('/orders').set('Authorization', 'Bearer ' + tokenA).send({ siteId: siteAId, items: [{ materialId: inStockMaterialId, quantity: 0.1 }] });
    expect(res.status).toBe(400);
  });

  it('rejects an inactive material with 404, same as an unknown one', async () => {
    const deactivated = await pool.query(
      "INSERT INTO materials (name, category_id, supplier_id, price_per_unit, unit, stock_status, min_order_quantity, quantity_step, estimated_delivery_days, is_active) SELECT 'Deactivated Test Material', category_id, supplier_id, price_per_unit, unit, 'in_stock', min_order_quantity, quantity_step, estimated_delivery_days, false FROM materials WHERE id = $1 RETURNING id",
      [inStockMaterialId],
    );
    const inactiveMaterialId = deactivated.rows[0].id;
    try {
      const res = await request(app).post('/orders').set('Authorization', 'Bearer ' + tokenA).send({ siteId: siteAId, items: [{ materialId: inactiveMaterialId, quantity: minOrderQuantity }] });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('MATERIAL_NOT_FOUND');
    } finally {
      await pool.query('DELETE FROM materials WHERE id = $1', [inactiveMaterialId]);
    }
  });

  it('ignores tampering fields and creates a normal requested order', async () => {
    const res = await request(app)
      .post('/orders')
      .set('Authorization', 'Bearer ' + tokenA)
      .send({
        siteId: siteAId,
        items: [{ materialId: inStockMaterialId, quantity: minOrderQuantity }],
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
        .send({ siteId: siteAId, items: [{ materialId: inStockMaterialId, quantity: minOrderQuantity }] });
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
        .send({ siteId: siteAId, items: [{ materialId: inStockMaterialId, quantity: minOrderQuantity }] });
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

  describe('Multi-item orders (Phase 3.3)', () => {
    it('creates a single order with all items for one material and one quantity — the one-item case, still exactly as before', async () => {
      const res = await request(app)
        .post('/orders')
        .set('Authorization', 'Bearer ' + tokenA)
        .send({ siteId: siteAId, items: [{ materialId: inStockMaterialId, quantity: minOrderQuantity }] });
      expect(res.status).toBe(201);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].materialId).toBe(inStockMaterialId);
      expect(res.body.items[0].quantity).toBe(minOrderQuantity);
    });

    it('creates one order carrying multiple different materials, each with its own quantity', async () => {
      const res = await request(app)
        .post('/orders')
        .set('Authorization', 'Bearer ' + tokenA)
        .send({
          siteId: siteAId,
          items: [
            { materialId: inStockMaterialId, quantity: minOrderQuantity },
            { materialId: inStockMaterialId2, quantity: minOrderQuantity2 + 1 },
          ],
        });
      expect(res.status).toBe(201);
      expect(res.body.items).toHaveLength(2);

      const itemsByMaterial = new Map(res.body.items.map((item: any) => [item.materialId, item]));
      expect((itemsByMaterial.get(inStockMaterialId) as any).quantity).toBe(minOrderQuantity);
      expect((itemsByMaterial.get(inStockMaterialId2) as any).quantity).toBe(minOrderQuantity2 + 1);

      // Exactly one orders row and exactly N order_items rows — not N separate orders.
      const orderCount = await pool.query('SELECT count(*)::int AS count FROM orders WHERE id = $1', [res.body.id]);
      expect(orderCount.rows[0].count).toBe(1);
      const itemCount = await pool.query('SELECT count(*)::int AS count FROM order_items WHERE order_id = $1', [res.body.id]);
      expect(itemCount.rows[0].count).toBe(2);
    });

    it('snapshots each item’s price_per_unit and material_name at submission time, independent of the live materials table afterward', async () => {
      const res = await request(app)
        .post('/orders')
        .set('Authorization', 'Bearer ' + tokenA)
        .send({
          siteId: siteAId,
          items: [
            { materialId: inStockMaterialId, quantity: minOrderQuantity },
            { materialId: inStockMaterialId2, quantity: minOrderQuantity2 },
          ],
        });
      expect(res.status).toBe(201);

      const liveMaterials = await request(app).get('/materials');
      const liveById = new Map(liveMaterials.body.map((m: any) => [m.id, m]));

      for (const item of res.body.items) {
        const live = liveById.get(item.materialId) as any;
        expect(item.pricePerUnit).toBe(live.pricePerUnit);
        expect(item.materialName).toBe(live.name);
      }

      // The snapshot is a copy, not a live join — updating the material afterward must never
      // retroactively change an already-placed order's recorded price.
      const originalPrice = res.body.items[0].pricePerUnit;
      await pool.query('UPDATE materials SET price_per_unit = price_per_unit + 999 WHERE id = $1', [inStockMaterialId]);
      try {
        const detail = await request(app).get('/orders/' + res.body.id).set('Authorization', 'Bearer ' + tokenA);
        const sameItem = detail.body.items.find((item: any) => item.materialId === inStockMaterialId);
        expect(sameItem.pricePerUnit).toBe(originalPrice);
      } finally {
        await pool.query('UPDATE materials SET price_per_unit = price_per_unit - 999 WHERE id = $1', [inStockMaterialId]);
      }
    });

    it('rejects the whole order when one item among several is an unknown material — no order or order_items rows persist', async () => {
      const before = await pool.query('SELECT count(*)::int AS count FROM orders WHERE site_id = $1', [siteAId]);

      const res = await request(app)
        .post('/orders')
        .set('Authorization', 'Bearer ' + tokenA)
        .send({
          siteId: siteAId,
          items: [
            { materialId: inStockMaterialId, quantity: minOrderQuantity },
            { materialId: '00000000-0000-0000-0000-000000000000', quantity: 1 },
          ],
        });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('MATERIAL_NOT_FOUND');

      const after = await pool.query('SELECT count(*)::int AS count FROM orders WHERE site_id = $1', [siteAId]);
      expect(after.rows[0].count).toBe(before.rows[0].count);
    });

    it('rejects the whole order when one item among several is out of stock — the valid item is not silently ordered alone', async () => {
      const before = await pool.query('SELECT count(*)::int AS count FROM orders WHERE site_id = $1', [siteAId]);

      const res = await request(app)
        .post('/orders')
        .set('Authorization', 'Bearer ' + tokenA)
        .send({
          siteId: siteAId,
          items: [
            { materialId: inStockMaterialId, quantity: minOrderQuantity },
            { materialId: outOfStockMaterialId, quantity: 1 },
          ],
        });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('MATERIAL_OUT_OF_STOCK');

      const after = await pool.query('SELECT count(*)::int AS count FROM orders WHERE site_id = $1', [siteAId]);
      expect(after.rows[0].count).toBe(before.rows[0].count);

      // Not even the valid item's material_name shows up anywhere — confirms no order_items row
      // was left behind for the item that WOULD have been valid on its own.
      const orphanItems = await pool.query('SELECT count(*)::int AS count FROM order_items WHERE material_id = $1 AND order_id NOT IN (SELECT id FROM orders)', [
        inStockMaterialId,
      ]);
      expect(orphanItems.rows[0].count).toBe(0);
    });

    it('rejects the whole order when one item is below its own material’s minimum quantity, even though other items are valid', async () => {
      const before = await pool.query('SELECT count(*)::int AS count FROM orders WHERE site_id = $1', [siteAId]);

      const res = await request(app)
        .post('/orders')
        .set('Authorization', 'Bearer ' + tokenA)
        .send({
          siteId: siteAId,
          items: [
            { materialId: inStockMaterialId, quantity: minOrderQuantity },
            { materialId: inStockMaterialId2, quantity: 0.01 },
          ],
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_PARAMETER');

      const after = await pool.query('SELECT count(*)::int AS count FROM orders WHERE site_id = $1', [siteAId]);
      expect(after.rows[0].count).toBe(before.rows[0].count);
    });

    it('rejects a duplicate material within the same submitted items array with 400', async () => {
      const res = await request(app)
        .post('/orders')
        .set('Authorization', 'Bearer ' + tokenA)
        .send({
          siteId: siteAId,
          items: [
            { materialId: inStockMaterialId, quantity: minOrderQuantity },
            { materialId: inStockMaterialId, quantity: minOrderQuantity },
          ],
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_PARAMETER');
    });

    it('rejects an items array over the 50-item cap with 400', async () => {
      const items = Array.from({ length: 51 }, () => ({ materialId: inStockMaterialId, quantity: minOrderQuantity }));
      const res = await request(app).post('/orders').set('Authorization', 'Bearer ' + tokenA).send({ siteId: siteAId, items });
      expect(res.status).toBe(400);
    });

    it('is idempotent for a multi-item submission — a replay never duplicates the order or its items', async () => {
      const key = `multi-item-idem-${Date.now()}`;
      const payload = {
        siteId: siteAId,
        items: [
          { materialId: inStockMaterialId, quantity: minOrderQuantity },
          { materialId: inStockMaterialId2, quantity: minOrderQuantity2 },
        ],
      };

      const first = await request(app).post('/orders').set('Authorization', 'Bearer ' + tokenA).set('Idempotency-Key', key).send(payload);
      expect(first.status).toBe(201);
      expect(first.body.items).toHaveLength(2);

      const second = await request(app).post('/orders').set('Authorization', 'Bearer ' + tokenA).set('Idempotency-Key', key).send(payload);
      expect(second.status).toBe(201);
      expect(second.body).toEqual(first.body);

      const itemCount = await pool.query('SELECT count(*)::int AS count FROM order_items WHERE order_id = $1', [first.body.id]);
      expect(itemCount.rows[0].count).toBe(2);
      const orderCount = await pool.query('SELECT count(*)::int AS count FROM orders WHERE id = $1', [first.body.id]);
      expect(orderCount.rows[0].count).toBe(1);
    });

    it('lists a multi-item order exactly once in the contractor’s order list, with all items aggregated', async () => {
      const createRes = await request(app)
        .post('/orders')
        .set('Authorization', 'Bearer ' + tokenA)
        .send({
          siteId: siteAId,
          items: [
            { materialId: inStockMaterialId, quantity: minOrderQuantity },
            { materialId: inStockMaterialId2, quantity: minOrderQuantity2 },
          ],
        });
      const orderId = createRes.body.id;

      const listRes = await request(app).get('/orders').set('Authorization', 'Bearer ' + tokenA);
      expect(listRes.status).toBe(200);
      const matches = listRes.body.filter((o: any) => o.id === orderId);
      // Exactly one row for this order — the pre-Phase-3.3 flat JOIN would have produced one row
      // per item (two rows for this order) instead.
      expect(matches).toHaveLength(1);
      expect(matches[0].items).toHaveLength(2);
    });

    it('is visible to HQ as one order with all items aggregated, same as the contractor’s own list', async () => {
      const createRes = await request(app)
        .post('/orders')
        .set('Authorization', 'Bearer ' + tokenA)
        .send({
          siteId: siteAId,
          items: [
            { materialId: inStockMaterialId, quantity: minOrderQuantity },
            { materialId: inStockMaterialId2, quantity: minOrderQuantity2 },
          ],
        });
      const orderId = createRes.body.id;

      const hqListRes = await request(app).get('/hq/orders').set('Authorization', 'Bearer ' + hqToken);
      expect(hqListRes.status).toBe(200);
      const matches = hqListRes.body.filter((o: any) => o.id === orderId);
      expect(matches).toHaveLength(1);
      expect(matches[0].items).toHaveLength(2);

      const hqDetailRes = await request(app).get('/hq/orders/' + orderId).set('Authorization', 'Bearer ' + hqToken);
      expect(hqDetailRes.status).toBe(200);
      expect(hqDetailRes.body.items).toHaveLength(2);
    });

    it('preserves item display order across contractor list, contractor detail, and HQ detail', async () => {
      const createRes = await request(app)
        .post('/orders')
        .set('Authorization', 'Bearer ' + tokenA)
        .send({
          siteId: siteAId,
          items: [
            { materialId: inStockMaterialId2, quantity: minOrderQuantity2 },
            { materialId: inStockMaterialId, quantity: minOrderQuantity },
          ],
        });
      const orderId = createRes.body.id;
      const submittedOrder = [inStockMaterialId2, inStockMaterialId];

      expect(createRes.body.items.map((item: any) => item.materialId)).toEqual(submittedOrder);

      const contractorDetail = await request(app).get('/orders/' + orderId).set('Authorization', 'Bearer ' + tokenA);
      expect(contractorDetail.body.items.map((item: any) => item.materialId)).toEqual(submittedOrder);

      const hqDetail = await request(app).get('/hq/orders/' + orderId).set('Authorization', 'Bearer ' + hqToken);
      expect(hqDetail.body.items.map((item: any) => item.materialId)).toEqual(submittedOrder);
    });

    it('walks a multi-item order through the full operational lifecycle exactly like a single-item one', async () => {
      const createRes = await request(app)
        .post('/orders')
        .set('Authorization', 'Bearer ' + tokenA)
        .send({
          siteId: siteAId,
          items: [
            { materialId: inStockMaterialId, quantity: minOrderQuantity },
            { materialId: inStockMaterialId2, quantity: minOrderQuantity2 },
          ],
        });
      const orderId = createRes.body.id;

      await transitionOrderStatus(orderId, 'supplier_contacted', contractorAId);
      await transitionOrderStatus(orderId, 'supplier_confirmed', contractorAId);
      await transitionOrderStatus(orderId, 'driver_assigned', contractorAId);
      await transitionOrderStatus(orderId, 'out_for_delivery', contractorAId);
      await transitionOrderStatus(orderId, 'delivered', contractorAId);

      const res = await request(app).get('/orders/' + orderId).set('Authorization', 'Bearer ' + tokenA);
      expect(res.body.status).toBe('delivered');
      expect(res.body.items).toHaveLength(2);
    });
  });
});


afterAll(async () => {
  await pool.end();
});
