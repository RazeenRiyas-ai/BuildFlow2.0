import { createReadStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Storage architecture (Phase 3.1): material photos are binary files, not relational data, so they
 * are written to local disk under UPLOADS_DIR — never into Postgres — with all queryable metadata
 * (dimensions, mime type, ordering, primary flag, timestamps) living in the `material_photos`
 * table. This project has no existing object-storage integration and runs as a single long-lived
 * Node process against a self-hosted Postgres instance (see config/db.ts, config/env.ts) — adding a
 * paid cloud object-storage provider here would be new infrastructure and a new class of secret to
 * manage for a capability local disk already covers correctly. Every disk-touching operation is
 * confined to this module: if the deployment later needs multi-instance/serverless storage (S3 or
 * equivalent), only this file's three functions need a new implementation — materials.service.ts
 * and the HQ/contractor routes never touch the filesystem directly.
 *
 * Path safety: every on-disk filename is `<photoId>.<extension>`, where `photoId` is a
 * server-generated UUID (material_photos.id, see migrations) and `extension` comes from
 * image-validation.ts's own sniffed-format allowlist ('jpg' | 'png' | 'webp') — never the client's
 * original filename or declared Content-Type. There is no code path where user-supplied text
 * reaches a filesystem path.
 */

const UPLOADS_ROOT = path.isAbsolute(env.UPLOADS_DIR) ? env.UPLOADS_DIR : path.join(process.cwd(), env.UPLOADS_DIR);

function materialDir(materialId: string): string {
  return path.join(UPLOADS_ROOT, 'materials', materialId);
}

export function photoStorageKey(materialId: string, photoId: string, extension: string): string {
  return path.join('materials', materialId, `${photoId}.${extension}`);
}

function absolutePathForKey(storageKey: string): string {
  return path.join(UPLOADS_ROOT, storageKey);
}

/**
 * Writes via a temp-file-then-rename within the same target directory so a concurrent reader (or a
 * process crash mid-write) can never observe a partially-written file at the final path — `rename`
 * within one filesystem is atomic. Returns the storage key to persist on the material_photos row.
 */
export async function savePhotoFile(materialId: string, photoId: string, extension: string, buffer: Buffer): Promise<string> {
  const dir = materialDir(materialId);
  await fs.mkdir(dir, { recursive: true });

  const finalPath = path.join(dir, `${photoId}.${extension}`);
  const tempPath = path.join(dir, `.${photoId}.${randomUUID()}.tmp`);

  await fs.writeFile(tempPath, buffer);
  await fs.rename(tempPath, finalPath);

  return photoStorageKey(materialId, photoId, extension);
}

/** Idempotent — deleting an already-absent file is treated as success (repeated delete requests,
 * or cleanup after a partially-applied earlier operation, must never surface as a 500). */
export async function deletePhotoFile(storageKey: string): Promise<void> {
  try {
    await fs.unlink(absolutePathForKey(storageKey));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    // Never let an orphaned-file cleanup failure fail the API request that triggered it (a DB row
    // delete/replace has already committed by the time this runs) — logged for operator cleanup.
    logger.warn('Failed to delete photo file from disk', { storageKey, errorMessage: (err as Error).message });
  }
}

export interface PhotoFileHandle {
  stream: NodeJS.ReadableStream;
  sizeBytes: number;
}

export async function readPhotoFile(storageKey: string): Promise<PhotoFileHandle> {
  const absolutePath = absolutePathForKey(storageKey);
  const stat = await fs.stat(absolutePath);
  return { stream: createReadStream(absolutePath), sizeBytes: stat.size };
}
