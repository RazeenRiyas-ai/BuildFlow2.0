import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { pool } from '../config/db';
import { deleteUserByPhone, uniquePhone } from './db-helpers';

// Logged in once and shared by every describe block below, rather than each block logging in
// separately — /auth/login sits behind authRateLimit (10/min, deliberately NOT skipped in tests,
// since auth-rate-limit.test.ts's own subject is that exact limiter), and vitest can reuse the
// same worker process/rate-limit bucket across multiple test files. Fewer redundant logins here
// reduces this file's own contribution to that shared budget.
let sharedHqToken: string;

beforeAll(async () => {
  const hqLogin = await request(app).post('/auth/login').send({ phone: '+91 90000 00001', password: 'password123' });
  sharedHqToken = hqLogin.body.accessToken;
});

describe('GET /suppliers', () => {
  let contractorToken: string;
  const contractorPhone = uniquePhone();

  beforeAll(async () => {
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
    const res = await request(app).get('/suppliers').set('Authorization', 'Bearer ' + sharedHqToken);
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
  let contractorToken: string;
  const contractorPhone = uniquePhone();

  beforeAll(async () => {
    const materials = await request(app).get('/materials');
    supplierId = materials.body[0].supplierId;

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
    const res = await request(app).get('/suppliers/' + supplierId).set('Authorization', 'Bearer ' + sharedHqToken);
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

describe('HQ supplier management (Phase 3.5)', () => {
  const contractorPhone = uniquePhone();
  const password = 'password123';
  let contractorToken: string;
  let siteId: string;
  let materialId: string;
  let minOrderQuantity: number;
  const createdSupplierIds: string[] = [];

  beforeAll(async () => {
    const reg = await request(app).post('/auth/register').send({ name: 'Suppliers Test Contractor', phone: contractorPhone, password });
    contractorToken = reg.body.accessToken;
    const contractorId = reg.body.user.id;

    const siteResult = await pool.query(
      'INSERT INTO construction_sites (contractor_id, label, address) VALUES ($1, $2, $3) RETURNING id',
      [contractorId, 'Suppliers Test Site', 'Suppliers Test Address'],
    );
    siteId = siteResult.rows[0].id;

    const materials = await request(app).get('/materials');
    const inStock = materials.body.find((m: any) => m.stockStatus === 'in_stock');
    materialId = inStock.id;
    minOrderQuantity = inStock.minOrderQuantity;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM orders WHERE site_id = $1', [siteId]);
    await pool.query('DELETE FROM construction_sites WHERE id = $1', [siteId]);
    await deleteUserByPhone(contractorPhone);
    if (createdSupplierIds.length > 0) {
      await pool.query('DELETE FROM suppliers WHERE id = ANY($1::uuid[])', [createdSupplierIds]);
    }
  });

  async function createSupplier(overrides: Record<string, unknown> = {}) {
    const res = await request(app)
      .post('/suppliers')
      .set('Authorization', 'Bearer ' + sharedHqToken)
      .send({
        name: 'Test Supplier ' + Math.random().toString(36).slice(2),
        locality: 'Test Locality',
        phone: '+91 90000 00000',
        ...overrides,
      });
    if (res.status === 201) createdSupplierIds.push(res.body.id);
    return res;
  }

  /** Creates a fresh order and advances it (via the real endpoint) to 'supplier_contacted' — the
   * precondition assign-supplier requires — so each test gets its own order rather than sharing one. */
  async function createOrderReadyForSupplierAssignment() {
    const orderRes = await request(app)
      .post('/orders')
      .set('Authorization', 'Bearer ' + contractorToken)
      .send({ siteId, items: [{ materialId, quantity: minOrderQuantity }] });
    const id = orderRes.body.id as string;

    await request(app).patch('/hq/orders/' + id + '/status').set('Authorization', 'Bearer ' + sharedHqToken).send({ status: 'supplier_contacted' });
    return id;
  }

  describe('CRUD access control', () => {
    it('rejects unauthenticated access to the supplier list with 401', async () => {
      const res = await request(app).get('/suppliers');
      expect(res.status).toBe(401);
    });

    it('rejects a contractor listing suppliers with 403', async () => {
      const res = await request(app).get('/suppliers').set('Authorization', 'Bearer ' + contractorToken);
      expect(res.status).toBe(403);
    });

    it('rejects a contractor creating a supplier with 403', async () => {
      const res = await request(app)
        .post('/suppliers')
        .set('Authorization', 'Bearer ' + contractorToken)
        .send({ name: 'Nope', locality: 'Nowhere' });
      expect(res.status).toBe(403);
    });

    it('rejects a contractor updating a supplier with 403', async () => {
      const created = await createSupplier();
      const res = await request(app)
        .patch('/suppliers/' + created.body.id)
        .set('Authorization', 'Bearer ' + contractorToken)
        .send({ name: 'Nope' });
      expect(res.status).toBe(403);
    });
  });

  describe('CRUD', () => {
    it('creates a supplier with name, locality, and phone', async () => {
      const res = await createSupplier({ name: 'Balaji Hardware', locality: 'Wagholi', phone: '+91 76897655' });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Balaji Hardware');
      expect(res.body.locality).toBe('Wagholi');
      expect(res.body.phone).toBe('+91 76897655');
      expect(res.body.isActive).toBe(true);
    });

    it('creates a supplier with no phone', async () => {
      const res = await createSupplier({ name: 'No Phone Supplier', phone: undefined });
      expect(res.status).toBe(201);
      expect(res.body.phone).toBeNull();
    });

    it('rejects creation with a missing name as a validation error', async () => {
      const res = await request(app)
        .post('/suppliers')
        .set('Authorization', 'Bearer ' + sharedHqToken)
        .send({ locality: 'Nowhere' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects creation with a missing locality as a validation error', async () => {
      const res = await request(app)
        .post('/suppliers')
        .set('Authorization', 'Bearer ' + sharedHqToken)
        .send({ name: 'No Locality Supplier' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('lists active suppliers, including newly created ones, and still returns phone (HQ-only view)', async () => {
      const created = await createSupplier();
      const res = await request(app).get('/suppliers').set('Authorization', 'Bearer ' + sharedHqToken);
      expect(res.status).toBe(200);
      const found = res.body.find((s: any) => s.id === created.body.id);
      expect(found).toBeTruthy();
      expect(found.phone).toBe('+91 90000 00000');
    });

    it('updates a supplier’s name, locality, and phone via PATCH', async () => {
      const created = await createSupplier();
      const res = await request(app)
        .patch('/suppliers/' + created.body.id)
        .set('Authorization', 'Bearer ' + sharedHqToken)
        .send({ name: 'Updated Name', locality: 'Updated Locality', phone: '+91 99999 99999' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Name');
      expect(res.body.locality).toBe('Updated Locality');
      expect(res.body.phone).toBe('+91 99999 99999');
    });

    it('rejects an empty PATCH body as a validation error', async () => {
      const created = await createSupplier();
      const res = await request(app).patch('/suppliers/' + created.body.id).set('Authorization', 'Bearer ' + sharedHqToken).send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 updating a nonexistent supplier', async () => {
      const res = await request(app)
        .patch('/suppliers/00000000-0000-0000-0000-000000000000')
        .set('Authorization', 'Bearer ' + sharedHqToken)
        .send({ name: 'Ghost' });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('SUPPLIER_NOT_FOUND');
    });

    it('deactivating a supplier hides it from the default (active-only) list but not from includeInactive=true', async () => {
      const created = await createSupplier();
      const deactivate = await request(app)
        .patch('/suppliers/' + created.body.id)
        .set('Authorization', 'Bearer ' + sharedHqToken)
        .send({ isActive: false });
      expect(deactivate.status).toBe(200);
      expect(deactivate.body.isActive).toBe(false);

      const activeOnly = await request(app).get('/suppliers').set('Authorization', 'Bearer ' + sharedHqToken);
      expect(activeOnly.body.some((s: any) => s.id === created.body.id)).toBe(false);

      const includingInactive = await request(app).get('/suppliers?includeInactive=true').set('Authorization', 'Bearer ' + sharedHqToken);
      expect(includingInactive.body.some((s: any) => s.id === created.body.id)).toBe(true);
    });

    it('deactivating a supplier does not affect its public GET /suppliers/:id lookup (contractors keep resolving it)', async () => {
      const created = await createSupplier({ name: 'Still Publicly Visible' });
      await request(app)
        .patch('/suppliers/' + created.body.id)
        .set('Authorization', 'Bearer ' + sharedHqToken)
        .send({ isActive: false });

      const res = await request(app).get('/suppliers/' + created.body.id).set('Authorization', 'Bearer ' + contractorToken);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Still Publicly Visible');
    });
  });

  describe('Assignment integration', () => {
    it('assigns a supplier by id — assignedSupplierId is a live pointer, never a snapshot', async () => {
      const supplier = await createSupplier({ name: 'Assigned Pointer Supplier' });
      const orderId = await createOrderReadyForSupplierAssignment();

      const res = await request(app)
        .post('/hq/orders/' + orderId + '/assign-supplier')
        .set('Authorization', 'Bearer ' + sharedHqToken)
        .send({ supplierId: supplier.body.id });
      expect(res.status).toBe(204);

      const detail = await request(app).get('/hq/orders/' + orderId).set('Authorization', 'Bearer ' + sharedHqToken);
      expect(detail.body.assignedSupplierId).toBe(supplier.body.id);
      // Unlike drivers, HqOrderDetail has no supplierName/supplierPhone at all — suppliers have
      // never been snapshotted onto an order, and this phase does not introduce that.
      expect(detail.body).not.toHaveProperty('supplierName');
    });

    it('rejects assigning an unknown supplier id with 404 SUPPLIER_NOT_FOUND', async () => {
      const orderId = await createOrderReadyForSupplierAssignment();
      const res = await request(app)
        .post('/hq/orders/' + orderId + '/assign-supplier')
        .set('Authorization', 'Bearer ' + sharedHqToken)
        .send({ supplierId: '00000000-0000-0000-0000-000000000000' });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('SUPPLIER_NOT_FOUND');
    });

    it('rejects assigning a deactivated supplier, the same way an unknown one is rejected', async () => {
      const supplier = await createSupplier({ name: 'Soon Inactive Supplier' });
      await request(app).patch('/suppliers/' + supplier.body.id).set('Authorization', 'Bearer ' + sharedHqToken).send({ isActive: false });

      const orderId = await createOrderReadyForSupplierAssignment();
      const res = await request(app)
        .post('/hq/orders/' + orderId + '/assign-supplier')
        .set('Authorization', 'Bearer ' + sharedHqToken)
        .send({ supplierId: supplier.body.id });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('SUPPLIER_NOT_FOUND');
    });

    it('rejects logging a supplier-contact against a deactivated supplier, the same way', async () => {
      const supplier = await createSupplier({ name: 'Soon Inactive Contact Supplier' });
      await request(app).patch('/suppliers/' + supplier.body.id).set('Authorization', 'Bearer ' + sharedHqToken).send({ isActive: false });

      const orderRes = await request(app)
        .post('/orders')
        .set('Authorization', 'Bearer ' + contractorToken)
        .send({ siteId, items: [{ materialId, quantity: minOrderQuantity }] });

      const res = await request(app)
        .post('/hq/orders/' + orderRes.body.id + '/supplier-contact')
        .set('Authorization', 'Bearer ' + sharedHqToken)
        .send({ supplierId: supplier.body.id, contactMethod: 'phone', outcome: 'n/a' });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('SUPPLIER_NOT_FOUND');
    });

    // This is the deliberate mirror-image of drivers.test.ts's "a driver record edited after
    // assignment never retroactively changes an already-assigned order's snapshot" test: for
    // suppliers, the correct, PRE-EXISTING behavior is the opposite, because no snapshot has ever
    // existed here. This test exists to lock that in and catch any future change that
    // accidentally introduces snapshot semantics for suppliers.
    it('editing a supplier’s name after assignment IS reflected when the supplier is looked up again (no snapshot exists for suppliers)', async () => {
      const supplier = await createSupplier({ name: 'Original Supplier Name' });
      const orderId = await createOrderReadyForSupplierAssignment();

      await request(app)
        .post('/hq/orders/' + orderId + '/assign-supplier')
        .set('Authorization', 'Bearer ' + sharedHqToken)
        .send({ supplierId: supplier.body.id });

      await request(app)
        .patch('/suppliers/' + supplier.body.id)
        .set('Authorization', 'Bearer ' + sharedHqToken)
        .send({ name: 'Changed Later Supplier Name' });

      const detail = await request(app).get('/hq/orders/' + orderId).set('Authorization', 'Bearer ' + sharedHqToken);
      expect(detail.body.assignedSupplierId).toBe(supplier.body.id);

      const supplierLookup = await request(app)
        .get('/suppliers/' + supplier.body.id)
        .set('Authorization', 'Bearer ' + sharedHqToken);
      expect(supplierLookup.body.name).toBe('Changed Later Supplier Name');
    });

    it('reassigning a different supplier overwrites the assigned pointer', async () => {
      const supplierA = await createSupplier({ name: 'Supplier A' });
      const supplierB = await createSupplier({ name: 'Supplier B' });
      const orderId = await createOrderReadyForSupplierAssignment();

      await request(app)
        .post('/hq/orders/' + orderId + '/assign-supplier')
        .set('Authorization', 'Bearer ' + sharedHqToken)
        .send({ supplierId: supplierA.body.id });
      await request(app)
        .post('/hq/orders/' + orderId + '/assign-supplier')
        .set('Authorization', 'Bearer ' + sharedHqToken)
        .send({ supplierId: supplierB.body.id });

      const detail = await request(app).get('/hq/orders/' + orderId).set('Authorization', 'Bearer ' + sharedHqToken);
      expect(detail.body.assignedSupplierId).toBe(supplierB.body.id);
    });
  });
});

afterAll(async () => {
  await pool.end();
});
