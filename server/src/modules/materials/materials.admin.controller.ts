import type { Request, Response } from 'express';
import multer from 'multer';
import { NotFoundError, AppError } from '../../utils/app-error';
import { ErrorCode } from '../../errors/error-codes';
import { env } from '../../config/env';
import { validateUploadedPhoto } from '../../utils/image-validation';
import * as materialsService from './materials.service';
import { toApiShape, toPhotoApiShape } from './materials.controller';
import { uploadPhotoFieldsSchema } from './materials.schemas';

/**
 * HQ-only material CRUD + photo management (mounted at /hq/materials by hq.routes.ts, behind that
 * router's existing `requireAuth, requireRole('hq_staff', 'hq_admin')` gate — see hq.routes.ts).
 * Deliberately a separate controller file from materials.controller.ts rather than branching inside
 * it: the public controller's functions are reused here (toApiShape/toPhotoApiShape) for a
 * consistent response shape, but the two audiences have different authorization, different
 * available fields (HQ sees inactive materials, contractors never do), and different write access.
 */

async function toAdminDetailShape(row: materialsService.MaterialRow) {
  const photos = await materialsService.listPhotosForMaterial(row.id);
  const primaryPhoto = photos.find((p) => p.is_primary);
  return {
    ...toApiShape(row, primaryPhoto),
    isFeatured: row.is_featured,
    isActive: row.is_active,
    photos: photos.map(toPhotoApiShape),
  };
}

export async function list(req: Request, res: Response) {
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  const categoryId = typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined;
  const includeInactive = req.query.includeInactive === 'true';

  const rows = await materialsService.listMaterialsForAdmin({ q, categoryId, includeInactive });
  const primaryPhotos = await materialsService.getPrimaryPhotosByMaterialIds(rows.map((r) => r.id));
  res.json(
    rows.map((row) => ({
      ...toApiShape(row, primaryPhotos.get(row.id)),
      isFeatured: row.is_featured,
      isActive: row.is_active,
    })),
  );
}

export async function getById(req: Request, res: Response) {
  const row = await materialsService.getMaterialByIdForAdmin(req.params.id);
  if (!row) throw new NotFoundError('Material not found', ErrorCode.MATERIAL_NOT_FOUND);
  res.json(await toAdminDetailShape(row));
}

export async function create(req: Request, res: Response) {
  const row = await materialsService.createMaterial(req.body);
  res.status(201).json(await toAdminDetailShape(row));
}

export async function update(req: Request, res: Response) {
  const row = await materialsService.updateMaterial(req.params.id, req.body);
  if (!row) throw new NotFoundError('Material not found', ErrorCode.MATERIAL_NOT_FOUND);
  res.json(await toAdminDetailShape(row));
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

/** Memory storage: files are validated (magic bytes + decoded dimensions) before ever touching
 * disk, so buffering the (size-capped) upload in memory first is simpler and safer than streaming
 * an unvalidated file straight to disk. `limits.fileSize` is a cheap first cutoff enforced by
 * multer itself, before this process ever allocates the full buffer; validateUploadedPhoto below
 * re-checks the same limit for defense in depth and for a consistent error shape either way. */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_PHOTO_UPLOAD_BYTES, files: 1 } });

/** Wraps multer's single-file middleware so a multer-specific failure (oversized file, no file
 * field) becomes this codebase's normal AppError/errorHandler path instead of an uncaught
 * MulterError reaching the generic 500 branch. */
export function uploadPhotoMiddleware(req: Request, res: Response, next: (err?: unknown) => void) {
  upload.single('photo')(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        next(
          new AppError(400, 'Uploaded file exceeds the maximum allowed size', ErrorCode.INVALID_PARAMETER, {
            field: 'photo',
            reason: 'file_too_large',
            maxBytes: env.MAX_PHOTO_UPLOAD_BYTES,
          }),
        );
        return;
      }
      next(new AppError(400, 'Invalid file upload', ErrorCode.INVALID_PARAMETER, { field: 'photo', reason: err.code }));
      return;
    }
    next(err);
  });
}

function requireUploadedFile(req: Request): Express.Multer.File {
  if (!req.file) {
    throw new AppError(400, 'No photo file was provided', ErrorCode.INVALID_PARAMETER, { field: 'photo', reason: 'missing_file' });
  }
  return req.file;
}

export async function listPhotos(req: Request, res: Response) {
  const material = await materialsService.getMaterialByIdForAdmin(req.params.id);
  if (!material) throw new NotFoundError('Material not found', ErrorCode.MATERIAL_NOT_FOUND);
  const photos = await materialsService.listPhotosForMaterial(req.params.id);
  res.json(photos.map(toPhotoApiShape));
}

export async function uploadPhoto(req: Request, res: Response) {
  const file = requireUploadedFile(req);
  const validated = validateUploadedPhoto(file.buffer);
  const fields = uploadPhotoFieldsSchema.parse(req.body);

  const photo = await materialsService.addMaterialPhoto({
    materialId: req.params.id,
    buffer: file.buffer,
    originalFilename: file.originalname ? file.originalname.slice(0, 255) : null,
    requestedPrimary: fields.isPrimary === 'true',
    ...validated,
  });
  res.status(201).json(toPhotoApiShape(photo));
}

export async function replacePhoto(req: Request, res: Response) {
  const file = requireUploadedFile(req);
  const validated = validateUploadedPhoto(file.buffer);

  const photo = await materialsService.replaceMaterialPhoto({
    materialId: req.params.id,
    photoId: req.params.photoId,
    buffer: file.buffer,
    originalFilename: file.originalname ? file.originalname.slice(0, 255) : null,
    ...validated,
  });
  res.json(toPhotoApiShape(photo));
}

export async function setPrimaryPhoto(req: Request, res: Response) {
  const photo = await materialsService.setPrimaryPhoto(req.params.id, req.params.photoId);
  res.json(toPhotoApiShape(photo));
}

export async function deletePhoto(req: Request, res: Response) {
  await materialsService.deleteMaterialPhoto(req.params.id, req.params.photoId);
  res.status(204).send();
}

export async function reorderPhotos(req: Request, res: Response) {
  const photos = await materialsService.reorderMaterialPhotos(req.params.id, req.body.photoIds);
  res.json(photos.map(toPhotoApiShape));
}
