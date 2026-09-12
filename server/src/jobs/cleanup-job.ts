import { env } from '../config/env';
import { logger } from '../utils/logger';
import { runExpiredRowCleanup } from '../modules/maintenance/cleanup.service';

/**
 * Starts the in-process periodic housekeeping check for expired idempotency_keys/refresh_tokens
 * rows (see cleanup.service.ts's runExpiredRowCleanup for the actual deletion criteria and why
 * it's conservative-by-construction). Mirrors stale-order-reminder-job.ts's structure exactly:
 * in-process setInterval, unref()'d so it never keeps the process alive on its own, deliberately
 * only ever started from server.ts — never app.ts — so no test file (which only ever imports
 * app.ts for supertest) accidentally starts a background timer that outlives the test.
 *
 * A failing tick is logged and never crashes the interval or the process — the next tick still
 * fires on schedule regardless of whether the previous one succeeded. (runExpiredRowCleanup itself
 * already isolates failures per-table and never throws, so this try/catch is a second, belt-and-
 * suspenders backstop, not the only thing standing between a bad tick and a crashed process.)
 *
 * Returns a stop function; server.ts calls it during shutdown so the timer doesn't keep the
 * process alive on its own once every other resource has already been closed.
 */
export function startCleanupJob(): () => void {
  const intervalMs = env.CLEANUP_JOB_INTERVAL_MINUTES * 60 * 1000;

  async function tick(): Promise<void> {
    try {
      const { idempotencyKeysDeleted, refreshTokensDeleted } = await runExpiredRowCleanup();
      if (idempotencyKeysDeleted > 0 || refreshTokensDeleted > 0) {
        logger.info('[cleanup-job] deleted expired rows', { idempotencyKeysDeleted, refreshTokensDeleted });
      }
    } catch (err) {
      logger.error('[cleanup-job] tick failed', err);
    }
  }

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref();

  logger.info('[cleanup-job] job started', { intervalMinutes: env.CLEANUP_JOB_INTERVAL_MINUTES });

  return () => {
    clearInterval(timer);
    logger.info('[cleanup-job] job stopped');
  };
}
