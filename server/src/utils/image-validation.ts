import { imageSize } from 'image-size';
import { env } from '../config/env';
import { AppError } from './app-error';
import { ErrorCode } from '../errors/error-codes';

/**
 * Uploaded images are untrusted input — this module is the single gate every photo upload/replace
 * passes through before a byte ever reaches disk. It deliberately never trusts the client-supplied
 * `Content-Type` header or the original filename/extension: both are attacker-controlled. Instead:
 *   1. The file's own magic bytes are sniffed to determine its *actual* format.
 *   2. `image-size` is asked to decode real pixel dimensions from those same bytes — a corrupt or
 *      truncated file (even one with valid-looking magic bytes) throws here, which is exactly the
 *      "actual image validity" check the file's magic bytes alone can't provide.
 *   3. Decoded dimensions are bounds-checked to reject a decompression-bomb-shaped image (a tiny
 *      file claiming an enormous pixel count).
 */

export const ALLOWED_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedPhotoMimeType = (typeof ALLOWED_PHOTO_MIME_TYPES)[number];

const EXTENSION_BY_MIME: Record<AllowedPhotoMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

interface MagicByteSignature {
  mimeType: AllowedPhotoMimeType;
  matches: (buf: Buffer) => boolean;
}

const SIGNATURES: MagicByteSignature[] = [
  { mimeType: 'image/jpeg', matches: (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff },
  {
    mimeType: 'image/png',
    matches: (buf) =>
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a,
  },
  {
    mimeType: 'image/webp',
    matches: (buf) =>
      buf.length >= 12 &&
      buf.toString('ascii', 0, 4) === 'RIFF' &&
      buf.toString('ascii', 8, 12) === 'WEBP',
  },
];

function sniffMimeType(buffer: Buffer): AllowedPhotoMimeType | null {
  const signature = SIGNATURES.find((sig) => sig.matches(buffer));
  return signature?.mimeType ?? null;
}

export interface ValidatedPhoto {
  mimeType: AllowedPhotoMimeType;
  extension: string;
  width: number;
  height: number;
}

/**
 * Throws an AppError(400, INVALID_PARAMETER) with a caller-facing `details.reason` for every
 * rejection path, never a raw parser exception — a malformed upload is expected client input, not
 * a 500-worthy server fault.
 */
export function validateUploadedPhoto(buffer: Buffer): ValidatedPhoto {
  if (buffer.byteLength === 0) {
    throw new AppError(400, 'Uploaded file is empty', ErrorCode.INVALID_PARAMETER, { field: 'photo', reason: 'empty_file' });
  }
  if (buffer.byteLength > env.MAX_PHOTO_UPLOAD_BYTES) {
    throw new AppError(400, 'Uploaded file exceeds the maximum allowed size', ErrorCode.INVALID_PARAMETER, {
      field: 'photo',
      reason: 'file_too_large',
      maxBytes: env.MAX_PHOTO_UPLOAD_BYTES,
    });
  }

  const mimeType = sniffMimeType(buffer);
  if (!mimeType) {
    throw new AppError(400, 'File is not a supported image type (JPEG, PNG, or WebP)', ErrorCode.INVALID_PARAMETER, {
      field: 'photo',
      reason: 'unsupported_type',
      allowed: ALLOWED_PHOTO_MIME_TYPES,
    });
  }

  let dimensions: { width?: number; height?: number; type?: string };
  try {
    dimensions = imageSize(buffer);
  } catch {
    throw new AppError(400, 'File could not be decoded as a valid image', ErrorCode.INVALID_PARAMETER, {
      field: 'photo',
      reason: 'invalid_image_data',
    });
  }

  const { width, height } = dimensions;
  if (!width || !height || width <= 0 || height <= 0) {
    throw new AppError(400, 'File could not be decoded as a valid image', ErrorCode.INVALID_PARAMETER, {
      field: 'photo',
      reason: 'invalid_image_data',
    });
  }
  if (width > env.MAX_PHOTO_DIMENSION_PX || height > env.MAX_PHOTO_DIMENSION_PX) {
    throw new AppError(400, 'Image dimensions exceed the maximum allowed', ErrorCode.INVALID_PARAMETER, {
      field: 'photo',
      reason: 'dimensions_too_large',
      maxDimensionPx: env.MAX_PHOTO_DIMENSION_PX,
    });
  }

  return { mimeType, extension: EXTENSION_BY_MIME[mimeType], width, height };
}
