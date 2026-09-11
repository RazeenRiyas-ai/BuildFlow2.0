import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import request from 'supertest';
import { app } from '../app';
import { pool } from '../config/db';
import { env } from '../config/env';
import { deleteUserByPhone, uniquePhone } from './db-helpers';
import { makeValidPngBuffer, makeOversizedPngBuffer, makeCorruptPngBuffer, makeNonImageBuffer } from './image-fixtures';

describe('HQ material management (Phase 3.1)', () => {
  const contractorPhone = uniquePhone();
  const password = 'password123';
  let contractorToken: string;
  let hqToken: string;
  let categoryId: string;
  let supplierId: string;
  const createdMaterialIds: string[] = [];

  beforeAll(async () => {
    const reg = await request(app).post('/auth/register').send({ name: 'Materials Test Contractor', phone: contractorPhone, password });
    contractorToken = reg.body.accessToken;

    const hqLogin = await request(app).post('/auth/login').send({ phone: '+91 90000 00001', password: 'password123' });
    hqToken = hqLogin.body.accessToken;

    categoryId = 'cement';
    const suppliers = await request(app).get('/suppliers').set('Authorization', 'Bearer ' + hqToken);
    supplierId = suppliers.body[0].id;
  });

  afterAll(async () => {
    await deleteUserByPhone(contractorPhone);
    if (createdMaterialIds.length > 0) {
      await pool.query('DELETE FROM materials WHERE id = ANY($1::uuid[])', [createdMaterialIds]);
    }
    const uploadsRoot = path.isAbsolute(env.UPLOADS_DIR) ? env.UPLOADS_DIR : path.join(process.cwd(), env.UPLOADS_DIR);
    await fs.rm(uploadsRoot, { recursive: true, force: true });
    await pool.end();
  });

  function baseMaterialPayload(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Test Material ' + Math.random().toString(36).slice(2),
      categoryId,
      supplierId,
      unit: 'bag',
      pricePerUnit: 100,
      stockStatus: 'in_stock',
      minOrderQuantity: 1,
      quantityStep: 1,
      estimatedDeliveryDays: '1-2 days',
      description: 'A material created for tests',
      isFeatured: false,
      isActive: true,
      ...overrides,
    };
  }

  async function createMaterial(overrides: Record<string, unknown> = {}) {
    const res = await request(app).post('/hq/materials').set('Authorization', 'Bearer ' + hqToken).send(baseMaterialPayload(overrides));
    expect(res.status).toBe(201);
    createdMaterialIds.push(res.body.id);
    return res.body;
  }

  // -------------------------------------------------------------------------
  // Authorization
  // -------------------------------------------------------------------------

  describe('authorization', () => {
    it('rejects unauthenticated access to the admin material list with 401', async () => {
      const res = await request(app).get('/hq/materials');
      expect(res.status).toBe(401);
    });

    it('rejects a contractor listing admin materials with 403', async () => {
      const res = await request(app).get('/hq/materials').set('Authorization', 'Bearer ' + contractorToken);
      expect(res.status).toBe(403);
    });

    it('rejects a contractor creating a material with 403', async () => {
      const res = await request(app).post('/hq/materials').set('Authorization', 'Bearer ' + contractorToken).send(baseMaterialPayload());
      expect(res.status).toBe(403);
    });

    it('rejects a contractor updating a material with 403', async () => {
      const material = await createMaterial();
      const res = await request(app)
        .patch('/hq/materials/' + material.id)
        .set('Authorization', 'Bearer ' + contractorToken)
        .send({ isActive: false });
      expect(res.status).toBe(403);
    });

    it('rejects a contractor uploading a photo with 403', async () => {
      const material = await createMaterial();
      const res = await request(app)
        .post('/hq/materials/' + material.id + '/photos')
        .set('Authorization', 'Bearer ' + contractorToken)
        .attach('photo', makeValidPngBuffer(), 'photo.png');
      expect(res.status).toBe(403);
    });

    it('allows HQ staff/admin to list admin materials', async () => {
      const res = await request(app).get('/hq/materials').set('Authorization', 'Bearer ' + hqToken);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Material CRUD
  // -------------------------------------------------------------------------

  describe('material creation, update, and deactivation', () => {
    it('creates a material with the given fields', async () => {
      const material = await createMaterial({ name: 'OPC Test Cement', pricePerUnit: 375.5, isFeatured: true });
      expect(material.name).toBe('OPC Test Cement');
      expect(material.pricePerUnit).toBe(375.5);
      expect(material.isFeatured).toBe(true);
      expect(material.isActive).toBe(true);
      expect(material.photos).toEqual([]);
    });

    it('rejects creation with a missing required field as a validation error', async () => {
      const payload = baseMaterialPayload() as Record<string, unknown>;
      delete payload.unit;
      const res = await request(app).post('/hq/materials').set('Authorization', 'Bearer ' + hqToken).send(payload);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ValidationError');
    });

    it('rejects creation referencing an unknown category with 404 CATEGORY_NOT_FOUND', async () => {
      const res = await request(app)
        .post('/hq/materials')
        .set('Authorization', 'Bearer ' + hqToken)
        .send(baseMaterialPayload({ categoryId: 'not-a-real-category' }));
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('CATEGORY_NOT_FOUND');
    });

    it('rejects creation referencing an unknown supplier with 404 SUPPLIER_NOT_FOUND', async () => {
      const res = await request(app)
        .post('/hq/materials')
        .set('Authorization', 'Bearer ' + hqToken)
        .send(baseMaterialPayload({ supplierId: '00000000-0000-0000-0000-000000000000' }));
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('SUPPLIER_NOT_FOUND');
    });

    it('updates material fields via PATCH', async () => {
      const material = await createMaterial();
      const res = await request(app)
        .patch('/hq/materials/' + material.id)
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ pricePerUnit: 420, description: 'Updated description', stockStatus: 'limited_stock' });
      expect(res.status).toBe(200);
      expect(res.body.pricePerUnit).toBe(420);
      expect(res.body.description).toBe('Updated description');
      expect(res.body.stockStatus).toBe('limited_stock');
    });

    it('rejects an empty PATCH body as a validation error', async () => {
      const material = await createMaterial();
      const res = await request(app).patch('/hq/materials/' + material.id).set('Authorization', 'Bearer ' + hqToken).send({});
      expect(res.status).toBe(400);
    });

    it('returns 404 updating a nonexistent material', async () => {
      const res = await request(app)
        .patch('/hq/materials/00000000-0000-0000-0000-000000000000')
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ isActive: false });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('MATERIAL_NOT_FOUND');
    });

    it('deactivates a material and hides it from every contractor-facing endpoint', async () => {
      const material = await createMaterial({ name: 'Deactivation Target Material' });

      const deactivate = await request(app)
        .patch('/hq/materials/' + material.id)
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ isActive: false });
      expect(deactivate.status).toBe(200);
      expect(deactivate.body.isActive).toBe(false);

      const publicDetail = await request(app).get('/materials/' + material.id);
      expect(publicDetail.status).toBe(404);
      expect(publicDetail.body.code).toBe('MATERIAL_NOT_FOUND');

      const publicList = await request(app).get('/materials');
      expect(publicList.body.some((m: any) => m.id === material.id)).toBe(false);

      const publicSearch = await request(app).get('/materials/search?q=' + encodeURIComponent('Deactivation Target Material'));
      expect(publicSearch.body.some((m: any) => m.id === material.id)).toBe(false);

      const categoryList = await request(app).get('/categories/' + categoryId + '/materials');
      expect(categoryList.body.some((m: any) => m.id === material.id)).toBe(false);

      // HQ can still see it, opting in with includeInactive.
      const adminHidden = await request(app).get('/hq/materials').set('Authorization', 'Bearer ' + hqToken);
      expect(adminHidden.body.some((m: any) => m.id === material.id)).toBe(false);
      const adminVisible = await request(app).get('/hq/materials?includeInactive=true').set('Authorization', 'Bearer ' + hqToken);
      expect(adminVisible.body.some((m: any) => m.id === material.id)).toBe(true);
      const adminDetail = await request(app).get('/hq/materials/' + material.id).set('Authorization', 'Bearer ' + hqToken);
      expect(adminDetail.status).toBe(200);
      expect(adminDetail.body.isActive).toBe(false);
    });

    it('an inactive material cannot be ordered, even by its exact id', async () => {
      const material = await createMaterial({ name: 'Cannot Order Me', minOrderQuantity: 1 });
      await request(app).patch('/hq/materials/' + material.id).set('Authorization', 'Bearer ' + hqToken).send({ isActive: false });

      const site = await pool.query('SELECT id FROM construction_sites LIMIT 1');
      const login = await request(app).post('/auth/login').send({ phone: '+91 98765 43210', password: 'password123' });
      const res = await request(app)
        .post('/orders')
        .set('Authorization', 'Bearer ' + login.body.accessToken)
        .send({ siteId: site.rows[0].id, items: [{ materialId: material.id, quantity: 1 }] });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('MATERIAL_NOT_FOUND');
    });

    it('reactivating a material makes it visible to contractors again', async () => {
      const material = await createMaterial({ name: 'Reactivate Me', isActive: false });
      let publicDetail = await request(app).get('/materials/' + material.id);
      expect(publicDetail.status).toBe(404);

      await request(app).patch('/hq/materials/' + material.id).set('Authorization', 'Bearer ' + hqToken).send({ isActive: true });

      publicDetail = await request(app).get('/materials/' + material.id);
      expect(publicDetail.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Photos
  // -------------------------------------------------------------------------

  describe('photo upload, listing, and the public detail response', () => {
    it('creates photo metadata on upload and returns it in the admin photo list', async () => {
      const material = await createMaterial();
      const uploadRes = await request(app)
        .post('/hq/materials/' + material.id + '/photos')
        .set('Authorization', 'Bearer ' + hqToken)
        .attach('photo', makeValidPngBuffer(4, 3), 'first.png');

      expect(uploadRes.status).toBe(201);
      expect(uploadRes.body.width).toBe(4);
      expect(uploadRes.body.height).toBe(3);
      // The first photo ever uploaded for a material becomes primary automatically.
      expect(uploadRes.body.isPrimary).toBe(true);
      expect(uploadRes.body.displayOrder).toBe(0);
      expect(typeof uploadRes.body.url).toBe('string');

      const listRes = await request(app).get('/hq/materials/' + material.id + '/photos').set('Authorization', 'Bearer ' + hqToken);
      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0].id).toBe(uploadRes.body.id);
    });

    it('a second photo defaults to non-primary and the next display order', async () => {
      const material = await createMaterial();
      await request(app).post('/hq/materials/' + material.id + '/photos').set('Authorization', 'Bearer ' + hqToken).attach('photo', makeValidPngBuffer(), 'a.png');
      const second = await request(app)
        .post('/hq/materials/' + material.id + '/photos')
        .set('Authorization', 'Bearer ' + hqToken)
        .attach('photo', makeValidPngBuffer(), 'b.png');

      expect(second.status).toBe(201);
      expect(second.body.isPrimary).toBe(false);
      expect(second.body.displayOrder).toBe(1);
    });

    it('an explicit isPrimary=true upload takes over as primary', async () => {
      const material = await createMaterial();
      const first = await request(app).post('/hq/materials/' + material.id + '/photos').set('Authorization', 'Bearer ' + hqToken).attach('photo', makeValidPngBuffer(), 'a.png');
      const second = await request(app)
        .post('/hq/materials/' + material.id + '/photos')
        .set('Authorization', 'Bearer ' + hqToken)
        .field('isPrimary', 'true')
        .attach('photo', makeValidPngBuffer(), 'b.png');

      expect(second.body.isPrimary).toBe(true);

      const list = await request(app).get('/hq/materials/' + material.id + '/photos').set('Authorization', 'Bearer ' + hqToken);
      const primaries = list.body.filter((p: any) => p.isPrimary);
      expect(primaries).toHaveLength(1);
      expect(primaries[0].id).toBe(second.body.id);
      expect(list.body.find((p: any) => p.id === first.body.id).isPrimary).toBe(false);
    });

    it('serves the uploaded photo bytes and shows them on the public material detail and list', async () => {
      const material = await createMaterial({ name: 'Photo Visible Material' });
      const upload = await request(app).post('/hq/materials/' + material.id + '/photos').set('Authorization', 'Bearer ' + hqToken).attach('photo', makeValidPngBuffer(5, 5), 'p.png');

      const publicDetail = await request(app).get('/materials/' + material.id);
      expect(publicDetail.status).toBe(200);
      expect(publicDetail.body.photos).toHaveLength(1);
      expect(publicDetail.body.photos[0].isPrimary).toBe(true);
      expect(publicDetail.body.imageUrl).toBe(upload.body.url);

      const publicList = await request(app).get('/materials');
      const listed = publicList.body.find((m: any) => m.id === material.id);
      expect(listed.imageUrl).toBe(upload.body.url);

      const fileRes = await request(app).get(upload.body.url);
      expect(fileRes.status).toBe(200);
      expect(fileRes.headers['content-type']).toBe('image/png');
    });

    it('a material with no photos falls back cleanly (no imageUrl, empty photos array)', async () => {
      const material = await createMaterial({ name: 'No Photo Material' });
      const publicDetail = await request(app).get('/materials/' + material.id);
      expect(publicDetail.body.imageUrl).toBeUndefined();
      expect(publicDetail.body.photos).toEqual([]);
    });

    it('does not serve a deactivated material’s photo to an anonymous/contractor caller, but does to HQ', async () => {
      const material = await createMaterial();
      const upload = await request(app).post('/hq/materials/' + material.id + '/photos').set('Authorization', 'Bearer ' + hqToken).attach('photo', makeValidPngBuffer(), 'p.png');
      await request(app).patch('/hq/materials/' + material.id).set('Authorization', 'Bearer ' + hqToken).send({ isActive: false });

      const anonymous = await request(app).get(upload.body.url);
      expect(anonymous.status).toBe(403);

      const asContractor = await request(app).get(upload.body.url).set('Authorization', 'Bearer ' + contractorToken);
      expect(asContractor.status).toBe(403);

      const asHq = await request(app).get(upload.body.url).set('Authorization', 'Bearer ' + hqToken);
      expect(asHq.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Primary-photo invariant, including under concurrency
  // -------------------------------------------------------------------------

  describe('primary-photo invariant', () => {
    it('POST .../primary switches the primary photo, keeping exactly one', async () => {
      const material = await createMaterial();
      const first = await request(app).post('/hq/materials/' + material.id + '/photos').set('Authorization', 'Bearer ' + hqToken).attach('photo', makeValidPngBuffer(), 'a.png');
      const second = await request(app).post('/hq/materials/' + material.id + '/photos').set('Authorization', 'Bearer ' + hqToken).attach('photo', makeValidPngBuffer(), 'b.png');

      const switchRes = await request(app)
        .post('/hq/materials/' + material.id + '/photos/' + second.body.id + '/primary')
        .set('Authorization', 'Bearer ' + hqToken);
      expect(switchRes.status).toBe(200);
      expect(switchRes.body.isPrimary).toBe(true);

      const list = await request(app).get('/hq/materials/' + material.id + '/photos').set('Authorization', 'Bearer ' + hqToken);
      expect(list.body.filter((p: any) => p.isPrimary)).toHaveLength(1);
      expect(list.body.find((p: any) => p.id === first.body.id).isPrimary).toBe(false);
      expect(list.body.find((p: any) => p.id === second.body.id).isPrimary).toBe(true);
    });

    it('CONCURRENCY: two simultaneous set-primary requests for different photos on the same material still leave exactly one primary', async () => {
      const material = await createMaterial();
      const photoA = await request(app).post('/hq/materials/' + material.id + '/photos').set('Authorization', 'Bearer ' + hqToken).attach('photo', makeValidPngBuffer(), 'a.png');
      const photoB = await request(app).post('/hq/materials/' + material.id + '/photos').set('Authorization', 'Bearer ' + hqToken).attach('photo', makeValidPngBuffer(), 'b.png');

      const [resA, resB] = await Promise.all([
        request(app).post('/hq/materials/' + material.id + '/photos/' + photoA.body.id + '/primary').set('Authorization', 'Bearer ' + hqToken),
        request(app).post('/hq/materials/' + material.id + '/photos/' + photoB.body.id + '/primary').set('Authorization', 'Bearer ' + hqToken),
      ]);
      expect([resA.status, resB.status]).toEqual([200, 200]);

      const list = await request(app).get('/hq/materials/' + material.id + '/photos').set('Authorization', 'Bearer ' + hqToken);
      expect(list.body.filter((p: any) => p.isPrimary)).toHaveLength(1);

      // The row-level unique index is the hard backstop for this invariant — assert it directly too.
      const dbCheck = await pool.query('SELECT count(*)::int AS count FROM material_photos WHERE material_id = $1 AND is_primary = true', [
        material.id,
      ]);
      expect(dbCheck.rows[0].count).toBe(1);
    });

    it('CONCURRENCY: two simultaneous isPrimary=true uploads on the same material still leave exactly one primary', async () => {
      const material = await createMaterial();

      const [uploadA, uploadB] = await Promise.all([
        request(app)
          .post('/hq/materials/' + material.id + '/photos')
          .set('Authorization', 'Bearer ' + hqToken)
          .field('isPrimary', 'true')
          .attach('photo', makeValidPngBuffer(), 'a.png'),
        request(app)
          .post('/hq/materials/' + material.id + '/photos')
          .set('Authorization', 'Bearer ' + hqToken)
          .field('isPrimary', 'true')
          .attach('photo', makeValidPngBuffer(), 'b.png'),
      ]);
      expect([uploadA.status, uploadB.status]).toEqual([201, 201]);

      const dbCheck = await pool.query('SELECT count(*)::int AS count FROM material_photos WHERE material_id = $1 AND is_primary = true', [
        material.id,
      ]);
      expect(dbCheck.rows[0].count).toBe(1);
    });

    it('the database itself refuses a second primary row for one material (defense in depth)', async () => {
      const material = await createMaterial();
      await pool.query(
        `INSERT INTO material_photos (material_id, storage_key, mime_type, byte_size, width, height, is_primary, display_order)
         VALUES ($1, 'test/k1', 'image/png', 10, 1, 1, true, 0)`,
        [material.id],
      );
      await expect(
        pool.query(
          `INSERT INTO material_photos (material_id, storage_key, mime_type, byte_size, width, height, is_primary, display_order)
           VALUES ($1, 'test/k2', 'image/png', 10, 1, 1, true, 1)`,
          [material.id],
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });

  // -------------------------------------------------------------------------
  // Replace, reorder, delete
  // -------------------------------------------------------------------------

  describe('photo replace, reorder, and deletion', () => {
    it('replaces a photo’s bytes while keeping its id and primary flag', async () => {
      const material = await createMaterial();
      const uploaded = await request(app).post('/hq/materials/' + material.id + '/photos').set('Authorization', 'Bearer ' + hqToken).attach('photo', makeValidPngBuffer(2, 2), 'a.png');

      const replaced = await request(app)
        .put('/hq/materials/' + material.id + '/photos/' + uploaded.body.id)
        .set('Authorization', 'Bearer ' + hqToken)
        .attach('photo', makeValidPngBuffer(9, 6), 'replacement.png');

      expect(replaced.status).toBe(200);
      expect(replaced.body.id).toBe(uploaded.body.id);
      expect(replaced.body.width).toBe(9);
      expect(replaced.body.height).toBe(6);
      expect(replaced.body.isPrimary).toBe(true);

      const fileRes = await request(app).get(replaced.body.url);
      expect(fileRes.status).toBe(200);
    });

    it('reorders photos and rejects a mismatched photoIds set', async () => {
      const material = await createMaterial();
      const a = await request(app).post('/hq/materials/' + material.id + '/photos').set('Authorization', 'Bearer ' + hqToken).attach('photo', makeValidPngBuffer(), 'a.png');
      const b = await request(app).post('/hq/materials/' + material.id + '/photos').set('Authorization', 'Bearer ' + hqToken).attach('photo', makeValidPngBuffer(), 'b.png');
      const c = await request(app).post('/hq/materials/' + material.id + '/photos').set('Authorization', 'Bearer ' + hqToken).attach('photo', makeValidPngBuffer(), 'c.png');

      const reordered = await request(app)
        .patch('/hq/materials/' + material.id + '/photos/order')
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ photoIds: [c.body.id, a.body.id, b.body.id] });

      expect(reordered.status).toBe(200);
      expect(reordered.body.map((p: any) => p.id)).toEqual([c.body.id, a.body.id, b.body.id]);
      expect(reordered.body.map((p: any) => p.displayOrder)).toEqual([0, 1, 2]);

      const mismatched = await request(app)
        .patch('/hq/materials/' + material.id + '/photos/order')
        .set('Authorization', 'Bearer ' + hqToken)
        .send({ photoIds: [a.body.id, b.body.id] });
      expect(mismatched.status).toBe(400);
    });

    it('deletes a photo, and a repeated delete of the same photo 404s cleanly instead of erroring', async () => {
      const material = await createMaterial();
      const uploaded = await request(app).post('/hq/materials/' + material.id + '/photos').set('Authorization', 'Bearer ' + hqToken).attach('photo', makeValidPngBuffer(), 'a.png');

      const del = await request(app).delete('/hq/materials/' + material.id + '/photos/' + uploaded.body.id).set('Authorization', 'Bearer ' + hqToken);
      expect(del.status).toBe(204);

      const list = await request(app).get('/hq/materials/' + material.id + '/photos').set('Authorization', 'Bearer ' + hqToken);
      expect(list.body).toHaveLength(0);

      const repeatedDelete = await request(app).delete('/hq/materials/' + material.id + '/photos/' + uploaded.body.id).set('Authorization', 'Bearer ' + hqToken);
      expect(repeatedDelete.status).toBe(404);

      const fileAfterDelete = await request(app).get(uploaded.body.url);
      expect(fileAfterDelete.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // Upload validation
  // -------------------------------------------------------------------------

  describe('invalid upload validation', () => {
    it('rejects a request with no file attached', async () => {
      const material = await createMaterial();
      const res = await request(app).post('/hq/materials/' + material.id + '/photos').set('Authorization', 'Bearer ' + hqToken);
      expect(res.status).toBe(400);
      expect(res.body.details?.reason).toBe('missing_file');
    });

    it('rejects a non-image file even with an image-like extension', async () => {
      const material = await createMaterial();
      const res = await request(app)
        .post('/hq/materials/' + material.id + '/photos')
        .set('Authorization', 'Bearer ' + hqToken)
        .attach('photo', makeNonImageBuffer(), 'totally-a-photo.png');
      expect(res.status).toBe(400);
      expect(res.body.details?.reason).toBe('unsupported_type');
    });

    it('rejects a file with valid magic bytes but corrupt image data', async () => {
      const material = await createMaterial();
      const res = await request(app)
        .post('/hq/materials/' + material.id + '/photos')
        .set('Authorization', 'Bearer ' + hqToken)
        .attach('photo', makeCorruptPngBuffer(), 'corrupt.png');
      expect(res.status).toBe(400);
      expect(res.body.details?.reason).toBe('invalid_image_data');
    });

    it('rejects an image whose dimensions exceed the configured maximum', async () => {
      const material = await createMaterial();
      const res = await request(app)
        .post('/hq/materials/' + material.id + '/photos')
        .set('Authorization', 'Bearer ' + hqToken)
        .attach('photo', makeOversizedPngBuffer(env.MAX_PHOTO_DIMENSION_PX + 1000), 'huge.png');
      expect(res.status).toBe(400);
      expect(res.body.details?.reason).toBe('dimensions_too_large');
    });

    it('rejects a file exceeding the maximum upload size', async () => {
      const material = await createMaterial();
      const oversizedBuffer = Buffer.alloc(env.MAX_PHOTO_UPLOAD_BYTES + 1024, 1);
      const res = await request(app)
        .post('/hq/materials/' + material.id + '/photos')
        .set('Authorization', 'Bearer ' + hqToken)
        .attach('photo', oversizedBuffer, 'huge.png');
      expect(res.status).toBe(400);
      expect(res.body.details?.reason).toBe('file_too_large');
    }, 20000);

    it('returns 404 uploading a photo for a nonexistent material', async () => {
      const res = await request(app)
        .post('/hq/materials/00000000-0000-0000-0000-000000000000/photos')
        .set('Authorization', 'Bearer ' + hqToken)
        .attach('photo', makeValidPngBuffer(), 'a.png');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('MATERIAL_NOT_FOUND');

      // No orphaned metadata row should have been created for the rejected upload.
      const orphanCheck = await pool.query('SELECT count(*)::int AS count FROM material_photos WHERE material_id = $1', [
        '00000000-0000-0000-0000-000000000000',
      ]);
      expect(orphanCheck.rows[0].count).toBe(0);
    });
  });
});
