import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { pool } from '../config/db';
import { createContractorSession, deleteUserByPhone, uniquePhone } from './db-helpers';

describe('Delivery charge (HQ sets/edits, contractor views)', () => {
  const contractorPhone = uniquePhone();
  const otherContractorPhone = uniquePhone();
  let contractorToken: string;
  let contractorId: string;
  let otherContractorToken: string;
  let hqToken: string;
  let siteId: string;
  let materialId: string;
  let minOrderQuantity: number;
  let supplierId: string;
  let driverId: string;

  beforeAll(async () => {
    const session = await createContractorSession('Delivery Charge Contractor', contractorPhone);
    contractorToken = session.accessToken;
    contractorId = session.userId;

    const otherSession = await createContractorSession('Delivery Charge Other Contractor', otherContractorPhone);
    otherContractorToken = otherSession.accessToken;

    const siteResult = await pool.query(
      'INSERT INTO construction_sites (contractor_id, label, address) VALUES ($1, $2, $3) RETURNING id',
      [contractorId, 'Delivery Charge Site', 'Delivery Charge Address'],
    );
    siteId = siteResult.rows[0].id;

    const materials = await request(app).get('/materials');
    const inStock = materials.body.find((m: any) => m.stockStatus === 'in_stock');
    materialId = inStock.id;
    minOrderQuantity = inStock.minOrderQuantity;

    const hqLogin = await request(app).post('/auth/login').send({ phone: '+91 90000 00001', password: 'password123' });
    hqToken = hqLogin.body.accessToken;

    const suppliers = await request(app).get('/suppliers').set('Authorization', 'Bearer ' + hqToken);
    supplierId = suppliers.body[0].id;

    const driverRes = await request(app)
      .post('/hq/drivers')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ name: 'Delivery Charge Driver' });
    driverId = driverRes.body.id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM orders WHERE site_id = $1', [siteId]);
    await pool.query('DELETE FROM construction_sites WHERE id = $1', [siteId]);
    await pool.query('DELETE FROM drivers WHERE id = $1', [driverId]);
    await deleteUserByPhone(contractorPhone);
    await deleteUserByPhone(otherContractorPhone);
  });

  /** Creates a fresh order and drives it, via the real endpoints, to `status`, the same way a real
   * HQ operator's own sequence of taps would. assignSupplier only requires `supplier_contacted`
   * (see hq.service.ts) — the separate supplier-contact log entry is not itself a precondition. */
  async function createOrderAtStatus(status: 'requested' | 'supplier_confirmed' | 'driver_assigned' | 'out_for_delivery' | 'delivered') {
    const orderRes = await request(app)
      .post('/orders')
      .set('Authorization', 'Bearer ' + contractorToken)
      .send({ siteId, items: [{ materialId, quantity: minOrderQuantity }] });
    const id = orderRes.body.id as string;
    if (status === 'requested') return id;

    await request(app).patch('/hq/orders/' + id + '/status').set('Authorization', 'Bearer ' + hqToken).send({ status: 'supplier_contacted' });
    await request(app).post('/hq/orders/' + id + '/assign-supplier').set('Authorization', 'Bearer ' + hqToken).send({ supplierId });
    await request(app).patch('/hq/orders/' + id + '/status').set('Authorization', 'Bearer ' + hqToken).send({ status: 'supplier_confirmed' });
    if (status === 'supplier_confirmed') return id;

    await request(app).post('/hq/orders/' + id + '/assign-driver').set('Authorization', 'Bearer ' + hqToken).send({ driverId });
    await request(app).patch('/hq/orders/' + id + '/status').set('Authorization', 'Bearer ' + hqToken).send({ status: 'driver_assigned' });
    if (status === 'driver_assigned') return id;

    await request(app).patch('/hq/orders/' + id + '/status').set('Authorization', 'Bearer ' + hqToken).send({ status: 'out_for_delivery' });
    if (status === 'out_for_delivery') return id;

    await request(app).patch('/hq/orders/' + id + '/status').set('Authorization', 'Bearer ' + hqToken).send({ status: 'delivered' });
    return id;
  }

  it('is null for both HQ and contractor before HQ ever sets it — never defaults to 0', async () => {
    const id = await createOrderAtStatus('supplier_confirmed');

    const hqDetail = await request(app).get('/hq/orders/' + id).set('Authorization', 'Bearer ' + hqToken);
    expect(hqDetail.body.deliveryCharge).toBeNull();

    const contractorDetail = await request(app).get('/orders/' + id).set('Authorization', 'Bearer ' + contractorToken);
    expect(contractorDetail.body.deliveryCharge).toBeNull();
    expect(contractorDetail.body.history.some((h: any) => h.type === 'delivery_charge_set')).toBe(false);
  });

  it('lets HQ set a positive delivery charge, visible to both HQ and the owning contractor', async () => {
    const id = await createOrderAtStatus('supplier_confirmed');

    const res = await request(app)
      .post('/hq/orders/' + id + '/delivery-charge')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ amount: 249.5, note: 'Confirmed with supplier dispatch' });
    expect(res.status).toBe(204);

    const hqDetail = await request(app).get('/hq/orders/' + id).set('Authorization', 'Bearer ' + hqToken);
    expect(hqDetail.body.deliveryCharge).toBe(249.5);

    const contractorDetail = await request(app).get('/orders/' + id).set('Authorization', 'Bearer ' + contractorToken);
    expect(contractorDetail.body.deliveryCharge).toBe(249.5);

    const historyEntry = contractorDetail.body.history.find((h: any) => h.type === 'delivery_charge_set');
    expect(historyEntry).toBeDefined();
    expect(historyEntry.amount).toBe(249.5);
  });

  it('treats an explicit 0 as free delivery — distinguishable from the null/not-yet-set state', async () => {
    const id = await createOrderAtStatus('supplier_confirmed');

    const res = await request(app)
      .post('/hq/orders/' + id + '/delivery-charge')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ amount: 0 });
    expect(res.status).toBe(204);

    const contractorDetail = await request(app).get('/orders/' + id).set('Authorization', 'Bearer ' + contractorToken);
    expect(contractorDetail.body.deliveryCharge).toBe(0);
    expect(contractorDetail.body.deliveryCharge).not.toBeNull();

    const hqDetail = await request(app).get('/hq/orders/' + id).set('Authorization', 'Bearer ' + hqToken);
    expect(hqDetail.body.deliveryCharge).toBe(0);
  });

  it('editing an existing charge overwrites the current value and appends a second audit row, not a replacement of the first', async () => {
    const id = await createOrderAtStatus('supplier_confirmed');

    const first = await request(app)
      .post('/hq/orders/' + id + '/delivery-charge')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ amount: 100 });
    expect(first.status).toBe(204);

    const second = await request(app)
      .post('/hq/orders/' + id + '/delivery-charge')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ amount: 175.25, note: 'Corrected after re-checking with supplier' });
    expect(second.status).toBe(204);

    const hqDetail = await request(app).get('/hq/orders/' + id).set('Authorization', 'Bearer ' + hqToken);
    expect(hqDetail.body.deliveryCharge).toBe(175.25);

    const chargeEntries = hqDetail.body.history.filter((h: any) => h.type === 'delivery_charge_set');
    expect(chargeEntries).toHaveLength(2);
    expect(chargeEntries.map((h: any) => h.amount).sort((a: number, b: number) => a - b)).toEqual([100, 175.25]);

    const contractorDetail = await request(app).get('/orders/' + id).set('Authorization', 'Bearer ' + contractorToken);
    expect(contractorDetail.body.deliveryCharge).toBe(175.25);
    expect(contractorDetail.body.history.filter((h: any) => h.type === 'delivery_charge_set')).toHaveLength(2);
  });

  it('allows setting the charge at every status in its allowed window: supplier_confirmed, driver_assigned, out_for_delivery', async () => {
    for (const status of ['supplier_confirmed', 'driver_assigned', 'out_for_delivery'] as const) {
      const id = await createOrderAtStatus(status);
      const res = await request(app)
        .post('/hq/orders/' + id + '/delivery-charge')
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ amount: 50 });
      expect(res.status).toBe(204);
    }
  });

  it('rejects setting the charge on a freshly-requested order (no supplier ever confirmed) with 409', async () => {
    const id = await createOrderAtStatus('requested');

    const res = await request(app)
      .post('/hq/orders/' + id + '/delivery-charge')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ amount: 50 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ORDER_ACTION_NOT_ALLOWED');

    const detail = await request(app).get('/hq/orders/' + id).set('Authorization', 'Bearer ' + hqToken);
    expect(detail.body.deliveryCharge).toBeNull();
  });

  it('rejects setting the charge once the order is delivered (terminal) with 409', async () => {
    const id = await createOrderAtStatus('delivered');

    const res = await request(app)
      .post('/hq/orders/' + id + '/delivery-charge')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ amount: 50 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ORDER_ACTION_NOT_ALLOWED');
  });

  it('rejects a negative amount with 400 and never touches the order', async () => {
    const id = await createOrderAtStatus('supplier_confirmed');

    const res = await request(app)
      .post('/hq/orders/' + id + '/delivery-charge')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ amount: -10 });
    expect(res.status).toBe(400);

    const detail = await request(app).get('/hq/orders/' + id).set('Authorization', 'Bearer ' + hqToken);
    expect(detail.body.deliveryCharge).toBeNull();
  });

  it('rejects an amount with more than 2 decimal places with 400', async () => {
    const id = await createOrderAtStatus('supplier_confirmed');

    const res = await request(app)
      .post('/hq/orders/' + id + '/delivery-charge')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ amount: 12.999 });
    expect(res.status).toBe(400);

    const detail = await request(app).get('/hq/orders/' + id).set('Authorization', 'Bearer ' + hqToken);
    expect(detail.body.deliveryCharge).toBeNull();
  });

  it('rejects a missing amount with 400', async () => {
    const id = await createOrderAtStatus('supplier_confirmed');

    const res = await request(app)
      .post('/hq/orders/' + id + '/delivery-charge')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({});
    expect(res.status).toBe(400);
  });

  it('rejects a contractor (even the order’s own owner) setting a delivery charge with 403', async () => {
    const id = await createOrderAtStatus('supplier_confirmed');

    const res = await request(app)
      .post('/hq/orders/' + id + '/delivery-charge')
      .set('Authorization', 'Bearer ' + contractorToken)
      .send({ amount: 50 });
    expect(res.status).toBe(403);

    const detail = await request(app).get('/orders/' + id).set('Authorization', 'Bearer ' + contractorToken);
    expect(detail.body.deliveryCharge).toBeNull();
  });

  it('rejects unauthenticated access with 401', async () => {
    const id = await createOrderAtStatus('supplier_confirmed');

    const res = await request(app).post('/hq/orders/' + id + '/delivery-charge').send({ amount: 50 });
    expect(res.status).toBe(401);
  });

  it("never leaks one contractor's delivery charge to another contractor", async () => {
    const id = await createOrderAtStatus('supplier_confirmed');
    await request(app)
      .post('/hq/orders/' + id + '/delivery-charge')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ amount: 88 });

    const res = await request(app).get('/orders/' + id).set('Authorization', 'Bearer ' + otherContractorToken);
    expect(res.status).toBe(404);
  });
});

afterAll(async () => {
  await pool.end();
});
