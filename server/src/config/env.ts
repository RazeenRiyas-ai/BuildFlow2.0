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
  // How long an order may sit in one of the HQ-coordination statuses (requested,
  // supplier_contacted, supplier_rejected, supplier_confirmed) with no further action before the
  // stale-order reminder job (jobs/stale-order-reminder-job.ts) treats it as stuck and reminds HQ.
  // Measured against orders.updated_at, which every existing HQ action already bumps — so any real
  // progress on the order naturally resets this clock without the job needing its own separate
  // tracking. Default: 4 hours. Phase 3.8: split from the dispatch tier below, since a legitimately
  // long delivery run was previously false-flagged by this same short threshold.
  STALE_ORDER_REMINDER_THRESHOLD_MINUTES: z.coerce.number().int().positive().default(240),
  // Same mechanism as above, but for the dispatch tier (driver_assigned, out_for_delivery) —
  // deliberately longer, since a delivery run can legitimately run for hours without that meaning
  // anything has stalled. Default: 10 hours.
  STALE_ORDER_REMINDER_DELIVERY_THRESHOLD_MINUTES: z.coerce.number().int().positive().default(600),
  // How often the stale-order reminder job checks for newly-stuck orders. Default: every 30
  // minutes — frequent enough that a stuck order is caught reasonably promptly, infrequent enough
  // to never be a meaningful load source.
  STALE_ORDER_REMINDER_CHECK_INTERVAL_MINUTES: z.coerce.number().int().positive().default(30),
  // How often the cleanup job (jobs/cleanup-job.ts) deletes expired idempotency_keys/refresh_tokens
  // rows. Default: every 60 minutes — this is pure housekeeping with no user-facing urgency (unlike
  // the stale-order check above), so a slower cadence is fine.
  CLEANUP_JOB_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60),
  // Sentry DSN for error tracking (Phase 3.9). Optional and unset by default: the observability
  // module (observability/sentry.ts) treats an absent DSN as "error tracking disabled" and never
  // initializes the SDK — so a missing/misconfigured DSN can never prevent the server from starting.
  SENTRY_DSN: z.string().optional(),
  // Tags every captured event so events from different environments are never confused in one
  // Sentry project. Deliberately free-text (not NODE_ENV, which nothing else in this app reads) —
  // set explicitly per deployment.
  SENTRY_ENVIRONMENT: z.string().default('development'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
