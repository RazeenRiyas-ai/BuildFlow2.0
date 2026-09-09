import { randomUUID } from 'crypto';
import { pool, withTransaction } from '../../config/db';
import { NotFoundError, AppError } from '../../utils/app-error';
import { ErrorCode } from '../../errors/error-codes';
import { savePhotoFile, deletePhotoFile } from '../../storage/photo-storage';
import type { ValidatedPhoto } from '../../utils/image-validation';

/** Referenced-entity existence checks shared by createMaterial/updateMaterial — mirrors the
 * existing convention in orders.service.ts's createOrder (a missing referenced site/material is a
 * NotFoundError with a domain-specific code, not a raw FK-violation 500) rather than letting an
 * unknown categoryId/supplierId fall through to Postgres's 23503 and the generic 500 branch in
 * errorHandler.ts, which only translates 23505 (unique violations), not FK violations. */
async function assertCategoryExists(categoryId: string): Promise<void> {
  const result = await pool.query('SELECT 1 FROM categories WHERE id = $1', [categoryId]);
  if (result.rowCount === 0) throw new NotFoundError('Category not found', ErrorCode.CATEGORY_NOT_FOUND, { field: 'categoryId' });
}

async function assertSupplierExists(supplierId: string): Promise<void> {
  const result = await pool.query('SELECT 1 FROM suppliers WHERE id = $1', [supplierId]);
  if (result.rowCount === 0) throw new NotFoundError('Supplier not found', ErrorCode.SUPPLIER_NOT_FOUND, { field: 'supplierId' });
}

export interface MaterialRow {
  id: string;
  name: string;
  category_id: string;
  supplier_id: string;
  image_url: string | null;
  price_per_unit: string;
  unit: string;
  stock_status: string;
  min_order_quantity: string;
  quantity_step: string;
  estimated_delivery_days: string;
  description: string | null;
  is_featured: boolean;
  is_active: boolean;
}

const SELECT_COLUMNS = `id, name, category_id, supplier_id, image_url, price_per_unit, unit, stock_status,
  min_order_quantity, quantity_step, estimated_delivery_days, description, is_featured, is_active`;

// ---------------------------------------------------------------------------
// Contractor-facing reads. Every one of these filters is_active = true — an inactive material is
// treated as though it doesn't exist for this audience (hidden from listings/search, 404 on direct
// lookup), which is also what makes it un-orderable without any extra check in orders.service.ts.
// ---------------------------------------------------------------------------

interface ListFilters {
  categoryId?: string;
  featured?: boolean;
}

export async function listMaterials(filters: ListFilters = {}) {
  const conditions: string[] = ['is_active = true'];
  const params: unknown[] = [];

  if (filters.categoryId) {
    params.push(filters.categoryId);
    conditions.push(`category_id = $${params.length}`);
  }
  if (filters.featured) {
    conditions.push('is_featured = true');
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const result = await pool.query<MaterialRow>(`SELECT ${SELECT_COLUMNS} FROM materials ${where} ORDER BY name`, params);
  return result.rows;
}

export async function getMaterialById(id: string) {
  const result = await pool.query<MaterialRow>(`SELECT ${SELECT_COLUMNS} FROM materials WHERE id = $1 AND is_active = true`, [id]);
  return result.rows[0] ?? null;
}

export async function searchMaterials(query: string) {
  const result = await pool.query<MaterialRow>(
    `SELECT ${SELECT_COLUMNS} FROM materials WHERE is_active = true AND name ILIKE '%' || $1 || '%' ORDER BY name`,
    [query],
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// HQ-facing reads/writes (mounted under /hq/materials, gated by requireRole('hq_staff', 'hq_admin')
// in hq.routes.ts). These deliberately never filter on is_active — HQ manages the full catalog,
// active or not.
// ---------------------------------------------------------------------------

interface AdminListFilters {
  q?: string;
  categoryId?: string;
  includeInactive: boolean;
}

export async function listMaterialsForAdmin(filters: AdminListFilters) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (!filters.includeInactive) {
    conditions.push('is_active = true');
  }
  if (filters.categoryId) {
    params.push(filters.categoryId);
    conditions.push(`category_id = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    conditions.push(`name ILIKE $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await pool.query<MaterialRow>(`SELECT ${SELECT_COLUMNS} FROM materials ${where} ORDER BY name`, params);
  return result.rows;
}

export async function getMaterialByIdForAdmin(id: string) {
  const result = await pool.query<MaterialRow>(`SELECT ${SELECT_COLUMNS} FROM materials WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export interface CreateMaterialInput {
  name: string;
  categoryId: string;
  supplierId: string;
  unit: string;
  pricePerUnit: number;
  stockStatus: string;
  minOrderQuantity: number;
  quantityStep: number;
  estimatedDeliveryDays: string;
  description?: string;
  isFeatured: boolean;
  isActive: boolean;
}

/** FK violations (an unknown categoryId/supplierId) surface as a plain Postgres foreign_key_violation
 * (SQLSTATE 23503); deliberately left untranslated here — validate.ts/zod already rejects malformed
 * ids, and errorHandler's generic unexpected-error branch turns anything else into a safe 500
 * without ever leaking schema detail, exactly like every other write path in this codebase. */
export async function createMaterial(input: CreateMaterialInput) {
  await assertCategoryExists(input.categoryId);
  await assertSupplierExists(input.supplierId);

  const result = await pool.query<MaterialRow>(
    `INSERT INTO materials
       (name, category_id, supplier_id, unit, price_per_unit, stock_status, min_order_quantity,
        quantity_step, estimated_delivery_days, description, is_featured, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING ${SELECT_COLUMNS}`,
    [
      input.name,
      input.categoryId,
      input.supplierId,
      input.unit,
      input.pricePerUnit,
      input.stockStatus,
      input.minOrderQuantity,
      input.quantityStep,
      input.estimatedDeliveryDays,
      input.description ?? null,
      input.isFeatured,
      input.isActive,
    ],
  );
  return result.rows[0];
}

export interface UpdateMaterialInput {
  name?: string;
  categoryId?: string;
  supplierId?: string;
  unit?: string;
  pricePerUnit?: number;
  stockStatus?: string;
  minOrderQuantity?: number;
  quantityStep?: number;
  estimatedDeliveryDays?: string;
  description?: string | null;
  isFeatured?: boolean;
  isActive?: boolean;
}

/** COLUMN_BY_KEY whitelists every column this function is allowed to touch — patch keys are typed
 * (UpdateMaterialInput), so this can never be driven by arbitrary client-supplied field names. */
const COLUMN_BY_KEY: Record<keyof UpdateMaterialInput, string> = {
  name: 'name',
  categoryId: 'category_id',
  supplierId: 'supplier_id',
  unit: 'unit',
  pricePerUnit: 'price_per_unit',
  stockStatus: 'stock_status',
  minOrderQuantity: 'min_order_quantity',
  quantityStep: 'quantity_step',
  estimatedDeliveryDays: 'estimated_delivery_days',
  description: 'description',
  isFeatured: 'is_featured',
  isActive: 'is_active',
};

export async function updateMaterial(id: string, patch: UpdateMaterialInput) {
  if (patch.categoryId !== undefined) await assertCategoryExists(patch.categoryId);
  if (patch.supplierId !== undefined) await assertSupplierExists(patch.supplierId);

  const entries = Object.entries(patch).filter(([, value]) => value !== undefined) as [keyof UpdateMaterialInput, unknown][];
  if (entries.length === 0) {
    return getMaterialByIdForAdmin(id);
  }

  const setClauses: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of entries) {
    params.push(value);
    setClauses.push(`${COLUMN_BY_KEY[key]} = $${params.length}`);
  }
  params.push(id);

  const result = await pool.query<MaterialRow>(
    `UPDATE materials SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING ${SELECT_COLUMNS}`,
    params,
  );
  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Photos. A material row is locked (SELECT ... FOR UPDATE) at the start of every mutation below
// that can affect which photo is primary or how photos are ordered — this is the same
// row-lock-then-mutate pattern orders.service.ts's transitionOrderStatus/hq.service.ts already use
// to make concurrent requests for the same resource serialize instead of interleave. The partial
// unique index from the migration (material_photos_one_primary_idx) is the hard backstop under
// that: even a bug in this locking would still be caught at the database as a 23505, which
// errorHandler.ts already turns into a 409.
// ---------------------------------------------------------------------------

export interface MaterialPhotoRow {
  id: string;
  material_id: string;
  storage_key: string;
  mime_type: string;
  byte_size: number;
  width: number;
  height: number;
  original_filename: string | null;
  is_primary: boolean;
  display_order: number;
  created_at: Date;
  updated_at: Date;
}

const PHOTO_COLUMNS = `id, material_id, storage_key, mime_type, byte_size, width, height,
  original_filename, is_primary, display_order, created_at, updated_at`;

export async function listPhotosForMaterial(materialId: string) {
  const result = await pool.query<MaterialPhotoRow>(
    `SELECT ${PHOTO_COLUMNS} FROM material_photos WHERE material_id = $1 ORDER BY display_order ASC, created_at ASC`,
    [materialId],
  );
  return result.rows;
}

/** Batches the primary-photo lookup for a page of materials into one query instead of N — used by
 * every list-shaped materials endpoint (list/search/by-category) to avoid an N+1 query per row. */
export async function getPrimaryPhotosByMaterialIds(materialIds: string[]): Promise<Map<string, MaterialPhotoRow>> {
  if (materialIds.length === 0) return new Map();
  const result = await pool.query<MaterialPhotoRow>(
    `SELECT ${PHOTO_COLUMNS} FROM material_photos WHERE material_id = ANY($1::uuid[]) AND is_primary = true`,
    [materialIds],
  );
  const map = new Map<string, MaterialPhotoRow>();
  for (const row of result.rows) map.set(row.material_id, row);
  return map;
}

/** Used by the public photo-file route to decide whether an anonymous/contractor caller may fetch
 * these bytes — joins the owning material's is_active so that route doesn't need a second query. */
export async function getPhotoWithMaterialActive(photoId: string) {
  const result = await pool.query<MaterialPhotoRow & { material_is_active: boolean }>(
    `SELECT mp.id, mp.material_id, mp.storage_key, mp.mime_type, mp.byte_size, mp.width, mp.height,
            mp.original_filename, mp.is_primary, mp.display_order, mp.created_at, mp.updated_at,
            m.is_active AS material_is_active
     FROM material_photos mp JOIN materials m ON m.id = mp.material_id
     WHERE mp.id = $1`,
    [photoId],
  );
  return result.rows[0] ?? null;
}

interface AddPhotoInput extends ValidatedPhoto {
  materialId: string;
  buffer: Buffer;
  originalFilename: string | null;
  requestedPrimary: boolean;
}

/**
 * Writes the file to disk BEFORE opening the database transaction, and rolls the file back (best
 * effort) if the metadata insert fails — so there is never a database row pointing at a file that
 * doesn't exist, which would be a broken image for every future viewer. The reverse case (a file on
 * disk with no referencing row, if the process crashes between the write and the insert committing)
 * is possible but harmless: nothing in the API can ever reach an unreferenced file, it is purely
 * wasted disk, and is the one orphaned-storage-object risk documented in the final report rather
 * than solved with a reconciliation job in this phase.
 */
export async function addMaterialPhoto(input: AddPhotoInput): Promise<MaterialPhotoRow> {
  const photoId = randomUUID();
  const storageKey = await savePhotoFile(input.materialId, photoId, input.extension, input.buffer);

  try {
    return await withTransaction(async (client) => {
      const material = await client.query('SELECT id FROM materials WHERE id = $1 FOR UPDATE', [input.materialId]);
      if (!material.rows[0]) throw new NotFoundError('Material not found', ErrorCode.MATERIAL_NOT_FOUND);

      const existingCount = await client.query('SELECT count(*)::int AS count FROM material_photos WHERE material_id = $1', [
        input.materialId,
      ]);
      const isFirstPhoto = existingCount.rows[0].count === 0;
      const makePrimary = input.requestedPrimary || isFirstPhoto;

      if (makePrimary) {
        await client.query('UPDATE material_photos SET is_primary = false, updated_at = now() WHERE material_id = $1 AND is_primary = true', [
          input.materialId,
        ]);
      }

      const maxOrder = await client.query('SELECT COALESCE(MAX(display_order), -1)::int AS max_order FROM material_photos WHERE material_id = $1', [
        input.materialId,
      ]);
      const displayOrder = maxOrder.rows[0].max_order + 1;

      const inserted = await client.query<MaterialPhotoRow>(
        `INSERT INTO material_photos
           (id, material_id, storage_key, mime_type, byte_size, width, height, original_filename, is_primary, display_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${PHOTO_COLUMNS}`,
        [
          photoId,
          input.materialId,
          storageKey,
          input.mimeType,
          input.buffer.byteLength,
          input.width,
          input.height,
          input.originalFilename,
          makePrimary,
          displayOrder,
        ],
      );
      return inserted.rows[0];
    });
  } catch (err) {
    await deletePhotoFile(storageKey);
    throw err;
  }
}

interface ReplacePhotoInput extends ValidatedPhoto {
  materialId: string;
  photoId: string;
  buffer: Buffer;
  originalFilename: string | null;
}

export async function replaceMaterialPhoto(input: ReplacePhotoInput): Promise<MaterialPhotoRow> {
  const newStorageKey = await savePhotoFile(input.materialId, input.photoId, input.extension, input.buffer);

  let oldStorageKey: string;
  let updatedRow: MaterialPhotoRow;
  try {
    const result = await withTransaction(async (client) => {
      const existing = await client.query<{ storage_key: string }>(
        'SELECT storage_key FROM material_photos WHERE id = $1 AND material_id = $2 FOR UPDATE',
        [input.photoId, input.materialId],
      );
      if (!existing.rows[0]) throw new NotFoundError('Photo not found', ErrorCode.NOT_FOUND);

      const updated = await client.query<MaterialPhotoRow>(
        `UPDATE material_photos
         SET storage_key = $1, mime_type = $2, byte_size = $3, width = $4, height = $5, original_filename = $6, updated_at = now()
         WHERE id = $7
         RETURNING ${PHOTO_COLUMNS}`,
        [newStorageKey, input.mimeType, input.buffer.byteLength, input.width, input.height, input.originalFilename, input.photoId],
      );
      return { oldStorageKey: existing.rows[0].storage_key, updatedRow: updated.rows[0] };
    });
    oldStorageKey = result.oldStorageKey;
    updatedRow = result.updatedRow;
  } catch (err) {
    await deletePhotoFile(newStorageKey);
    throw err;
  }

  if (oldStorageKey !== newStorageKey) {
    await deletePhotoFile(oldStorageKey);
  }
  return updatedRow;
}

export async function setPrimaryPhoto(materialId: string, photoId: string): Promise<MaterialPhotoRow> {
  return withTransaction(async (client) => {
    const material = await client.query('SELECT id FROM materials WHERE id = $1 FOR UPDATE', [materialId]);
    if (!material.rows[0]) throw new NotFoundError('Material not found', ErrorCode.MATERIAL_NOT_FOUND);

    const target = await client.query('SELECT id FROM material_photos WHERE id = $1 AND material_id = $2', [photoId, materialId]);
    if (!target.rows[0]) throw new NotFoundError('Photo not found', ErrorCode.NOT_FOUND);

    await client.query(
      'UPDATE material_photos SET is_primary = false, updated_at = now() WHERE material_id = $1 AND is_primary = true AND id != $2',
      [materialId, photoId],
    );
    const updated = await client.query<MaterialPhotoRow>(
      `UPDATE material_photos SET is_primary = true, updated_at = now() WHERE id = $1 RETURNING ${PHOTO_COLUMNS}`,
      [photoId],
    );
    return updated.rows[0];
  });
}

/** Deletes the metadata row first (inside a transaction), then removes the on-disk file only after
 * that commits — never before, so a failed transaction never leaves a database row pointing at a
 * file that's already gone. The file deletion itself is best-effort (see deletePhotoFile) and never
 * throws: a repeated DELETE request naturally 404s on the second call (the row is already gone),
 * which is the desired idempotent-ish behavior without any extra bookkeeping. */
export async function deleteMaterialPhoto(materialId: string, photoId: string): Promise<void> {
  const storageKey = await withTransaction(async (client) => {
    const existing = await client.query<{ storage_key: string }>(
      'SELECT storage_key FROM material_photos WHERE id = $1 AND material_id = $2 FOR UPDATE',
      [photoId, materialId],
    );
    if (!existing.rows[0]) throw new NotFoundError('Photo not found', ErrorCode.NOT_FOUND);

    await client.query('DELETE FROM material_photos WHERE id = $1', [photoId]);
    return existing.rows[0].storage_key;
  });

  await deletePhotoFile(storageKey);
}

export async function reorderMaterialPhotos(materialId: string, orderedPhotoIds: string[]): Promise<MaterialPhotoRow[]> {
  return withTransaction(async (client) => {
    const material = await client.query('SELECT id FROM materials WHERE id = $1 FOR UPDATE', [materialId]);
    if (!material.rows[0]) throw new NotFoundError('Material not found', ErrorCode.MATERIAL_NOT_FOUND);

    const existing = await client.query<{ id: string }>('SELECT id FROM material_photos WHERE material_id = $1 FOR UPDATE', [materialId]);
    const existingIds = new Set(existing.rows.map((r) => r.id));
    const requestedIds = new Set(orderedPhotoIds);

    if (existingIds.size !== requestedIds.size || [...existingIds].some((id) => !requestedIds.has(id))) {
      throw new AppError(400, 'photoIds must exactly match this material’s current photos', ErrorCode.INVALID_PARAMETER, {
        field: 'photoIds',
      });
    }

    for (let i = 0; i < orderedPhotoIds.length; i += 1) {
      await client.query('UPDATE material_photos SET display_order = $1, updated_at = now() WHERE id = $2', [i, orderedPhotoIds[i]]);
    }

    const updated = await client.query<MaterialPhotoRow>(
      `SELECT ${PHOTO_COLUMNS} FROM material_photos WHERE material_id = $1 ORDER BY display_order ASC, created_at ASC`,
      [materialId],
    );
    return updated.rows;
  });
}
