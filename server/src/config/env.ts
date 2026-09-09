import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('*'),
  EXPO_PUSH_URL: z.string().default('https://exp.host/--/api/v2/push/send'),
  // Local-disk root for uploaded material photos (see storage/photo-storage.ts). Resolved relative
  // to the server process's cwd when not absolute, mirroring how DATABASE_URL/JWT secrets are
  // plain env-driven config rather than anything environment-specific baked into code. Never
  // exposed to the client — the mobile app only ever sees the photo URLs the API hands back.
  UPLOADS_DIR: z.string().min(1).default('uploads'),
  // 8MB: generous for a phone-camera product photo, small enough that a handful of concurrent
  // uploads can't meaningfully pressure server memory (files are buffered in memory only briefly,
  // between multer's memory storage and the validated write to disk — see materials photo routes).
  MAX_PHOTO_UPLOAD_BYTES: z.coerce.number().int().positive().default(8 * 1024 * 1024),
  // Guards against a decompression-bomb-shaped image (tiny file, enormous pixel dimensions) that
  // would be cheap to upload but expensive for every client that ever renders it.
  MAX_PHOTO_DIMENSION_PX: z.coerce.number().int().positive().default(6000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
