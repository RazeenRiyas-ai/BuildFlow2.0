import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { pool } from '../config/db';
import { deleteUserByPhone, uniquePhone } from './db-helpers';

describe('HQ module', () => {
  const contractorPhone = uniquePhone();
  const password = 'password123';
  let contractorToken: string;
  let hqToken: string;
  let siteId: string;
  let materialId: string;
  let supplierId: string;
  let orderId: string;

  beforeAll(async () => {
    const reg = await request(app).post('/auth/register').send({ name: 'HQ Test Contractor', phone: contractorPhone, password: password });
    contractorToken = reg.body.accessToken;
    const contractorId = reg.body.user.id;

    const siteInsertSql = 'INSERT INTO construction_sites (contractor_id, label, address) VALUES ($1, $2, $3) RETURNING id';
    const siteResult = await pool.query(siteInsertSql, [contractorId, 'HQ Test Site', 'HQ Test Address']);
    siteId = siteResult.rows[0].id;

    const materials = await request(app).get('/materials');
    const inStock = materials.body.find((m: any) => m.stockStatus === 'in_stock');
    materialId = inStock.id;
    supplierId = inStock.supplierId;

    const orderRes = await request(app)
      .post('/orders')
      .set('Authorization', 'Bearer ' + contractorToken)
      .send({ siteId, items: [{ materialId, quantity: inStock.minOrderQuantity }] });
    orderId = orderRes.body.id;

    const hqLogin = await request(app).post('/auth/login').send({ phone: '+91 90000 00001', password: 'password123' });
    hqToken = hqLogin.body.accessToken;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM orders WHERE site_id = $1', [siteId]);
    await pool.query('DELETE FROM construction_sites WHERE id = $1', [siteId]);
    await deleteUserByPhone(contractorPhone);
  });

  it('rejects unauthenticated access to the queue with 401', async () => {
    const res = await request(app).get('/hq/orders');
    expect(res.status).toBe(401);
  });

  it('rejects a contractor accessing the queue with 403', async () => {
    const res = await request(app).get('/hq/orders').set('Authorization', 'Bearer ' + contractorToken);
    expect(res.status).toBe(403);
  });

  it('lets HQ see the order in the queue', async () => {
    const res = await request(app).get('/hq/orders').set('Authorization', 'Bearer ' + hqToken);
    expect(res.status).toBe(200);
    expect(res.body.some((o: any) => o.id === orderId)).toBe(true);
  });

  it('lets HQ view the order detail with contractor info', async () => {
    const res = await request(app).get('/hq/orders/' + orderId).set('Authorization', 'Bearer ' + hqToken);
    expect(res.status).toBe(200);
    expect(res.body.contractorName).toBe('HQ Test Contractor');
    expect(res.body.status).toBe('requested');
  });

  it('walks the order through the full manual workflow', async () => {
    let res = await request(app)
      .patch('/hq/orders/' + orderId + '/status')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ status: 'supplier_contacted' });
    expect(res.status).toBe(204);

    res = await request(app)
      .post('/hq/orders/' + orderId + '/supplier-contact')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ supplierId, contactMethod: 'phone', outcome: 'confirmed' });
    expect(res.status).toBe(204);

    res = await request(app)
      .post('/hq/orders/' + orderId + '/assign-supplier')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ supplierId });
    expect(res.status).toBe(204);

    res = await request(app)
      .patch('/hq/orders/' + orderId + '/status')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ status: 'supplier_confirmed' });
    expect(res.status).toBe(204);

    res = await request(app)
      .post('/hq/orders/' + orderId + '/assign-driver')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ driverName: 'Ramesh', driverPhone: '+91 90000 55555' });
    expect(res.status).toBe(204);

    res = await request(app)
      .patch('/hq/orders/' + orderId + '/status')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ status: 'driver_assigned' });
    expect(res.status).toBe(204);

    res = await request(app)
      .post('/hq/orders/' + orderId + '/delivery-update')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ note: 'Truck departed warehouse' });
    expect(res.status).toBe(204);

    res = await request(app)
      .patch('/hq/orders/' + orderId + '/status')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ status: 'out_for_delivery' });
    expect(res.status).toBe(204);

    res = await request(app)
      .patch('/hq/orders/' + orderId + '/status')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ status: 'delivered' });
    expect(res.status).toBe(204);

    const detail = await request(app).get('/hq/orders/' + orderId).set('Authorization', 'Bearer ' + hqToken);
    expect(detail.body.status).toBe('delivered');
    expect(detail.body.assignedSupplierId).toBe(supplierId);
    expect(detail.body.driverName).toBe('Ramesh');
    expect(detail.body.history.length).toBeGreaterThanOrEqual(7);
  });

  it('rejects an invalid transition with 409', async () => {
    const res = await request(app)
      .patch('/hq/orders/' + orderId + '/status')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ status: 'requested' });
    expect(res.status).toBe(409);
  });

  it('rejects contractor attempts to update status with 403', async () => {
    const res = await request(app)
      .patch('/hq/orders/' + orderId + '/status')
      .set('Authorization', 'Bearer ' + contractorToken)
      .send({ status: 'delivered' });
    expect(res.status).toBe(403);
  });
});

describe('HQ operational integrity — state validation and concurrency', () => {
  const contractorPhone = uniquePhone();
  const password = 'password123';
  let contractorToken: string;
  let contractorId: string;
  let hqToken: string;
  let siteId: string;
  let materialId: string;
  let minOrderQuantity: number;
  let supplierAId: string;
  let supplierBId: string;

  beforeAll(async () => {
    const reg = await request(app)
      .post('/auth/register')
      .send({ name: 'HQ Integrity Contractor', phone: contractorPhone, password });
    contractorToken = reg.body.accessToken;
    contractorId = reg.body.user.id;

    const siteResult = await pool.query(
      'INSERT INTO construction_sites (contractor_id, label, address) VALUES ($1, $2, $3) RETURNING id',
      [contractorId, 'HQ Integrity Site', 'HQ Integrity Address'],
    );
    siteId = siteResult.rows[0].id;

    const materials = await request(app).get('/materials');
    const inStock = materials.body.find((m: any) => m.stockStatus === 'in_stock');
    materialId = inStock.id;
    minOrderQuantity = inStock.minOrderQuantity;

    const hqLogin = await request(app).post('/auth/login').send({ phone: '+91 90000 00001', password: 'password123' });
    hqToken = hqLogin.body.accessToken;

    const suppliers = await request(app).get('/suppliers').set('Authorization', 'Bearer ' + hqToken);
    supplierAId = suppliers.body[0].id;
    supplierBId = suppliers.body[1].id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM orders WHERE site_id = $1', [siteId]);
    await pool.query('DELETE FROM construction_sites WHERE id = $1', [siteId]);
    await deleteUserByPhone(contractorPhone);
  });

  /** Creates a fresh order and drives it, via the real endpoints, to just past `status`, so each
   * test gets its own order at a known precondition instead of sharing/depending on other tests'
   * mutations of one shared order. */
  async function createOrderAtStatus(status: 'requested' | 'supplier_contacted' | 'supplier_confirmed' | 'driver_assigned') {
    const orderRes = await request(app)
      .post('/orders')
      .set('Authorization', 'Bearer ' + contractorToken)
      .send({ siteId, items: [{ materialId, quantity: minOrderQuantity }] });
    const id = orderRes.body.id as string;
    if (status === 'requested') return id;

    await request(app)
      .patch('/hq/orders/' + id + '/status')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ status: 'supplier_contacted' });
    if (status === 'supplier_contacted') return id;

    await request(app)
      .patch('/hq/orders/' + id + '/status')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ status: 'supplier_confirmed' });
    if (status === 'supplier_confirmed') return id;

    await request(app)
      .patch('/hq/orders/' + id + '/status')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ status: 'driver_assigned' });
    return id;
  }

  it('rejects assign-driver on a freshly-requested order (no supplier ever confirmed) with 409', async () => {
    const id = await createOrderAtStatus('requested');

    const res = await request(app)
      .post('/hq/orders/' + id + '/assign-driver')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ driverName: 'Too Early' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ORDER_ACTION_NOT_ALLOWED');

    const detail = await request(app).get('/hq/orders/' + id).set('Authorization', 'Bearer ' + hqToken);
    expect(detail.body.driverName).toBeUndefined();
  });

  it('rejects assign-supplier on a delivered/terminal-adjacent order it was never valid for', async () => {
    const id = await createOrderAtStatus('requested');

    const res = await request(app)
      .post('/hq/orders/' + id + '/assign-supplier')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ supplierId: supplierAId });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ORDER_ACTION_NOT_ALLOWED');
  });

  it('rejects supplier-contact and delivery-update on a cancelled order', async () => {
    const id = await createOrderAtStatus('requested');
    await request(app)
      .patch('/hq/orders/' + id + '/status')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ status: 'cancelled' });

    const contactRes = await request(app)
      .post('/hq/orders/' + id + '/supplier-contact')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ supplierId: supplierAId, contactMethod: 'phone', outcome: 'n/a' });
    expect(contactRes.status).toBe(409);
    expect(contactRes.body.code).toBe('ORDER_ACTION_NOT_ALLOWED');

    const deliveryRes = await request(app)
      .post('/hq/orders/' + id + '/delivery-update')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ note: 'should not be allowed' });
    expect(deliveryRes.status).toBe(409);
    expect(deliveryRes.body.code).toBe('ORDER_ACTION_NOT_ALLOWED');
  });

  it('CONCURRENCY: two HQ staff assigning different suppliers to the same order at once both persist, with no lost write', async () => {
    const id = await createOrderAtStatus('supplier_contacted');

    const [resA, resB] = await Promise.all([
      request(app)
        .post('/hq/orders/' + id + '/assign-supplier')
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ supplierId: supplierAId, note: 'from staff A' }),
      request(app)
        .post('/hq/orders/' + id + '/assign-supplier')
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ supplierId: supplierBId, note: 'from staff B' }),
    ]);

    // Neither loses to a state-validity check here — the order stays 'supplier_contacted'
    // throughout (assigning a supplier doesn't itself change status), so both are legitimately
    // valid concurrent writes to the same mutable field. The lock (SELECT ... FOR UPDATE) still
    // did real work: it serialized the two transactions so neither read-modify-write interleaved
    // with the other — provable by both history rows existing afterward, not just one.
    expect([resA.status, resB.status]).toEqual([204, 204]);

    const detail = await request(app).get('/hq/orders/' + id).set('Authorization', 'Bearer ' + hqToken);
    expect([supplierAId, supplierBId]).toContain(detail.body.assignedSupplierId);

    const assignmentHistory = detail.body.history.filter((h: any) => h.type === 'supplier_assigned');
    expect(assignmentHistory).toHaveLength(2);
    const assignedSuppliers = assignmentHistory.map((h: any) => h.supplierId).sort();
    expect(assignedSuppliers).toEqual([supplierAId, supplierBId].sort());
  });

  it('CONCURRENCY: assigning a driver races a concurrent cancellation — the database stays internally consistent and the loser (if any) gets a clean error', async () => {
    const id = await createOrderAtStatus('supplier_confirmed');

    const [driverRes, cancelRes] = await Promise.all([
      request(app)
        .post('/hq/orders/' + id + '/assign-driver')
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ driverName: 'Race Driver' }),
      request(app)
        .patch('/hq/orders/' + id + '/status')
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ status: 'cancelled' }),
    ]);

    // The cancellation is a plain state-machine transition (supplier_confirmed -> cancelled is
    // always allowed) so it can never itself be the "loser" here — only assign-driver can be
    // rejected, if it loses the row-lock race and re-reads a status that's no longer valid for it.
    expect(cancelRes.status).toBe(204);

    const detail = await request(app).get('/hq/orders/' + id).set('Authorization', 'Bearer ' + hqToken);
    expect(detail.body.status).toBe('cancelled');

    if (driverRes.status === 204) {
      // assign-driver's transaction committed before the cancellation's — a real, valid sequence
      // (a driver was assigned, then the order was cancelled moments later). The record must be
      // internally consistent with that history, not corrupted.
      expect(detail.body.driverName).toBe('Race Driver');
    } else {
      // The cancellation won the race — assign-driver correctly saw the now-cancelled order and
      // refused, and must not have partially applied.
      expect(driverRes.status).toBe(409);
      expect(driverRes.body.code).toBe('ORDER_ACTION_NOT_ALLOWED');
      expect(detail.body.driverName).toBeUndefined();
    }
  });
});

afterAll(async () => {
  await pool.end();
});
