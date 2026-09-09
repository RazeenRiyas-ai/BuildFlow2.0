import type { Request, Response } from 'express';
import { NotFoundError, ForbiddenError } from '../../utils/app-error';
import { ErrorCode } from '../../errors/error-codes';
import { readPhotoFile } from '../../storage/photo-storage';
import * as materialsService from './materials.service';
import type { MaterialRow, MaterialPhotoRow } from './materials.service';

export function buildPhotoUrl(materialId: string, photoId: string): string {
  return `/materials/${materialId}/photos/${photoId}/file`;
}

export function toPhotoApiShape(row: MaterialPhotoRow) {
  return {
    id: row.id,
    url: buildPhotoUrl(row.material_id, row.id),
    isPrimary: row.is_primary,
    displayOrder: row.display_order,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
  };
}

export function toApiShape(row: MaterialRow, primaryPhoto?: MaterialPhotoRow) {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.category_id,
    supplierId: row.supplier_id,
    imageUrl: primaryPhoto ? buildPhotoUrl(row.id, primaryPhoto.id) : (row.image_url ?? undefined),
    pricePerUnit: Number(row.price_per_unit),
    unit: row.unit,
    stockStatus: row.stock_status,
    minOrderQuantity: Number(row.min_order_quantity),
    quantityStep: Number(row.quantity_step),
    estimatedDeliveryDays: row.estimated_delivery_days,
    description: row.description ?? undefined,
  };
}

export async function list(req: Request, res: Response) {
  const featured = req.query.featured === 'true';
  const rows = await materialsService.listMaterials({ featured });
  const primaryPhotos = await materialsService.getPrimaryPhotosByMaterialIds(rows.map((r) => r.id));
  res.json(rows.map((row) => toApiShape(row, primaryPhotos.get(row.id))));
}

export async function getById(req: Request, res: Response) {
  const row = await materialsService.getMaterialById(req.params.id);
  if (!row) throw new NotFoundError('Material not found', ErrorCode.MATERIAL_NOT_FOUND);
  const photos = await materialsService.listPhotosForMaterial(row.id);
  const primaryPhoto = photos.find((p) => p.is_primary);
  res.json({ ...toApiShape(row, primaryPhoto), photos: photos.map(toPhotoApiShape) });
}

export async function listByCategory(req: Request, res: Response) {
  const rows = await materialsService.listMaterials({ categoryId: req.params.id });
  const primaryPhotos = await materialsService.getPrimaryPhotosByMaterialIds(rows.map((r) => r.id));
  res.json(rows.map((row) => toApiShape(row, primaryPhotos.get(row.id))));
}

export async function search(req: Request, res: Response) {
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  const rows = await materialsService.searchMaterials(query);
  const primaryPhotos = await materialsService.getPrimaryPhotosByMaterialIds(rows.map((r) => r.id));
  res.json(rows.map((row) => toApiShape(row, primaryPhotos.get(row.id))));
}

/**
 * Public-ish photo file route (mounted with `optionalAuth`, not `requireAuth` — see
 * materials.routes.ts): an active material's photos are visible to anyone the same way the rest of
 * the catalog is, matching this app's existing pre-Phase-3.1 convention of an unauthenticated
 * `/materials` router. A photo belonging to a deactivated material is only served to a caller whose
 * bearer token (if any — optionalAuth never requires one) actually carries an HQ role, so HQ can
 * still preview/manage photos on a material it just deactivated.
 */
export async function getPhotoFile(req: Request, res: Response) {
  const { materialId, photoId } = req.params;
  const photo = await materialsService.getPhotoWithMaterialActive(photoId);
  if (!photo || photo.material_id !== materialId) {
    throw new NotFoundError('Photo not found', ErrorCode.NOT_FOUND);
  }

  if (!photo.material_is_active) {
    const role = req.user?.role;
    if (role !== 'hq_staff' && role !== 'hq_admin') {
      throw new ForbiddenError('This material is not available', ErrorCode.FORBIDDEN);
    }
  }

  const file = await readPhotoFile(photo.storage_key);
  res.setHeader('Content-Type', photo.mime_type);
  res.setHeader('Content-Length', String(file.sizeBytes));
  // Short cache lifetime rather than a long/immutable one: a "replace photo" keeps this same URL
  // (photoId doesn't change) but swaps the underlying bytes, so a long client-side cache could keep
  // showing stale content for a while after HQ replaces a photo.
  res.setHeader('Cache-Control', 'public, max-age=300');
  file.stream.pipe(res);
}
