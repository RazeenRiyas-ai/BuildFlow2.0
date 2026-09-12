import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { pool } from '../config/db';
import { deleteUserByPhone, uniquePhone } from './db-helpers';

describe('HQ driver management (Phase 3.4)', () => {
  const contractorPhone = uniquePhone();
  const password = 'password123';
  let contractorToken: string;
  let hqToken: string;
  let siteId: string;
  let materialId: string;
  let minOrderQuantity: number;
  let supplierId: string;
  const createdDriverIds: string[] = [];

  beforeAll(async () => {
    const reg = await request(app).post('/auth/register').send({ name: 'Drivers Test Contractor', phone: contractorPhone, password });
    contractorToken = reg.body.accessToken;
    const contractorId = reg.body.user.id;

    const siteResult = await pool.query(
      'INSERT INTO construction_sites (contractor_id, label, address) VALUES ($1, $2, $3) RETURNING id',
      [contractorId, 'Drivers Test Site', 'Drivers Test Address'],
    );
    siteId = siteResult.rows[0].id;

    const materials = await request(app).get('/materials');
    const inStock = materials.body.find((m: any) => m.stockStatus === 'in_stock');
    materialId = inStock.id;
    minOrderQuantity = inStock.minOrderQuantity;
    supplierId = inStock.supplierId;

    const hqLogin = await request(app).post('/auth/login').send({ phone: '+91 90000 00001', password: 'password123' });
    hqToken = hqLogin.body.accessToken;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM orders WHERE site_id = $1', [siteId]);
    await pool.query('DELETE FROM construction_sites WHERE id = $1', [siteId]);
    await deleteUserByPhone(contractorPhone);
    if (createdDriverIds.length > 0) {
      await pool.query('DELETE FROM drivers WHERE id = ANY($1::uuid[])', [createdDriverIds]);
    }
    await pool.end();
  });

  async function createDriver(overrides: Record<string, unknown> = {}) {
    const res = await request(app)
      .post('/hq/drivers')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ name: 'Test Driver ' + Math.random().toString(36).slice(2), phone: '+91 90000 00000', ...overrides });
    if (res.status === 201) createdDriverIds.push(res.body.id);
    return res;
  }

  /** Creates a fresh order and drives it (via the real endpoints) to 'supplier_confirmed' — the
   * precondition assign-driver requires — so each test gets its own order rather than sharing one. */
  async function createOrderReadyForDriver() {
    const orderRes = await request(app)
      .post('/orders')
      .set('Authorization', 'Bearer ' + contractorToken)
      .send({ siteId, items: [{ materialId, quantity: minOrderQuantity }] });
    const id = orderRes.body.id as string;

    await request(app).patch('/hq/orders/' + id + '/status').set('Authorization', 'Bearer ' + hqToken).send({ status: 'supplier_contacted' });
    await request(app)
      .post('/hq/orders/' + id + '/assign-supplier')
      .set('Authorization', 'Bearer ' + hqToken)
      .send({ supplierId });
    await request(app).patch('/hq/orders/' + id + '/status').set('Authorization', 'Bearer ' + hqToken).send({ status: 'supplier_confirmed' });
    return id;
  }

  describe('CRUD access control', () => {
    it('rejects unauthenticated access to the driver list with 401', async () => {
      const res = await request(app).get('/hq/drivers');
      expect(res.status).toBe(401);
    });

    it('rejects a contractor listing drivers with 403', async () => {
      const res = await request(app).get('/hq/drivers').set('Authorization', 'Bearer ' + contractorToken);
      expect(res.status).toBe(403);
    });

    it('rejects a contractor creating a driver with 403', async () => {
      const res = await request(app).post('/hq/drivers').set('Authorization', 'Bearer ' + contractorToken).send({ name: 'Nope' });
      expect(res.status).toBe(403);
    });

    it('rejects a contractor updating a driver with 403', async () => {
      const created = await createDriver();
      const res = await request(app)
        .patch('/hq/drivers/' + created.body.id)
        .set('Authorization', 'Bearer ' + contractorToken)
        .send({ name: 'Nope' });
      expect(res.status).toBe(403);
    });
  });

  describe('CRUD', () => {
    it('creates a driver with name and phone', async () => {
      const res = await createDriver({ name: 'Ganesh', phone: '+91 76897655' });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Ganesh');
      expect(res.body.phone).toBe('+91 76897655');
      expect(res.body.isActive).toBe(true);
    });

    it('creates a driver with no phone', async () => {
      const res = await createDriver({ name: 'No Phone Driver', phone: undefined });
      expect(res.status).toBe(201);
      expect(res.body.phone).toBeUndefined();
    });

    it('rejects creation with a missing name as a validation error', async () => {
      const res = await request(app).post('/hq/drivers').set('Authorization', 'Bearer ' + hqToken).send({ phone: '+91 90000 00000' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('lists active drivers, including newly created ones', async () => {
      const created = await createDriver();
      const res = await request(app).get('/hq/drivers').set('Authorization', 'Bearer ' + hqToken);
      expect(res.status).toBe(200);
      expect(res.body.some((d: any) => d.id === created.body.id)).toBe(true);
    });

    it('updates a driver’s name and phone via PATCH', async () => {
      const created = await createDriver();
      const res = await request(app)
        .patch('/hq/drivers/' + created.body.id)
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ name: 'Updated Name', phone: '+91 99999 99999' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Name');
      expect(res.body.phone).toBe('+91 99999 99999');
    });

    it('rejects an empty PATCH body as a validation error', async () => {
      const created = await createDriver();
      const res = await request(app).patch('/hq/drivers/' + created.body.id).set('Authorization', 'Bearer ' + hqToken).send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 updating a nonexistent driver', async () => {
      const res = await request(app)
        .patch('/hq/drivers/00000000-0000-0000-0000-000000000000')
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ name: 'Ghost' });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('DRIVER_NOT_FOUND');
    });

    it('deactivating a driver hides it from the default (active-only) list but not from includeInactive=true', async () => {
      const created = await createDriver();
      const deactivate = await request(app)
        .patch('/hq/drivers/' + created.body.id)
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ isActive: false });
      expect(deactivate.status).toBe(200);
      expect(deactivate.body.isActive).toBe(false);

      const activeOnly = await request(app).get('/hq/drivers').set('Authorization', 'Bearer ' + hqToken);
      expect(activeOnly.body.some((d: any) => d.id === created.body.id)).toBe(false);

      const includingInactive = await request(app).get('/hq/drivers?includeInactive=true').set('Authorization', 'Bearer ' + hqToken);
      expect(includingInactive.body.some((d: any) => d.id === created.body.id)).toBe(true);
    });
  });

  describe('Assignment integration', () => {
    it('assigns a driver by id and snapshots its name/phone onto the order', async () => {
      const driver = await createDriver({ name: 'Assigned Snapshot Driver', phone: '+91 90000 11111' });
      const orderId = await createOrderReadyForDriver();

      const res = await request(app)
        .post('/hq/orders/' + orderId + '/assign-driver')
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ driverId: driver.body.id });
      expect(res.status).toBe(204);

      const detail = await request(app).get('/hq/orders/' + orderId).set('Authorization', 'Bearer ' + hqToken);
      expect(detail.body.assignedDriverId).toBe(driver.body.id);
      expect(detail.body.driverName).toBe('Assigned Snapshot Driver');
      expect(detail.body.driverPhone).toBe('+91 90000 11111');
    });

    it('rejects assigning an unknown driver id with 404 DRIVER_NOT_FOUND', async () => {
      const orderId = await createOrderReadyForDriver();
      const res = await request(app)
        .post('/hq/orders/' + orderId + '/assign-driver')
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ driverId: '00000000-0000-0000-0000-000000000000' });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('DRIVER_NOT_FOUND');
    });

    it('rejects assigning a deactivated driver, the same way an unknown one is rejected', async () => {
      const driver = await createDriver({ name: 'Soon Inactive' });
      await request(app).patch('/hq/drivers/' + driver.body.id).set('Authorization', 'Bearer ' + hqToken).send({ isActive: false });

      const orderId = await createOrderReadyForDriver();
      const res = await request(app)
        .post('/hq/orders/' + orderId + '/assign-driver')
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ driverId: driver.body.id });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('DRIVER_NOT_FOUND');
    });

    it('a driver record edited after assignment never retroactively changes an already-assigned order’s snapshot', async () => {
      const driver = await createDriver({ name: 'Original Name', phone: '+91 90000 22222' });
      const orderId = await createOrderReadyForDriver();

      await request(app)
        .post('/hq/orders/' + orderId + '/assign-driver')
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ driverId: driver.body.id });

      // Edit the canonical driver record AFTER it was already assigned to this order.
      await request(app)
        .patch('/hq/drivers/' + driver.body.id)
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ name: 'Changed Later', phone: '+91 90000 33333' });

      const detail = await request(app).get('/hq/orders/' + orderId).set('Authorization', 'Bearer ' + hqToken);
      expect(detail.body.driverName).toBe('Original Name');
      expect(detail.body.driverPhone).toBe('+91 90000 22222');
    });

    it('reassigning a different driver overwrites both the pointer and the snapshot', async () => {
      const driverA = await createDriver({ name: 'Driver A', phone: '+91 90000 44444' });
      const driverB = await createDriver({ name: 'Driver B', phone: '+91 90000 55555' });
      const orderId = await createOrderReadyForDriver();

      await request(app)
        .post('/hq/orders/' + orderId + '/assign-driver')
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ driverId: driverA.body.id });
      await request(app)
        .post('/hq/orders/' + orderId + '/assign-driver')
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ driverId: driverB.body.id });

      const detail = await request(app).get('/hq/orders/' + orderId).set('Authorization', 'Bearer ' + hqToken);
      expect(detail.body.assignedDriverId).toBe(driverB.body.id);
      expect(detail.body.driverName).toBe('Driver B');
      expect(detail.body.driverPhone).toBe('+91 90000 55555');
    });
  });
});
