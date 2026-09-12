import { env } from '../config/env';
import { logger } from '../utils/logger';
import { sendStaleOrderReminders } from '../modules/orders/orders.service';

/**
 * Starts the in-process periodic check for stuck orders (see orders.service.ts's
 * sendStaleOrderReminders for the actual claiming query and why it's safe under concurrent
 * invocations). Deliberately only ever started from server.ts — the real running process — never
 * from app.ts, so no test file (which only ever imports app.ts for supertest) accidentally starts
 * a background timer that outlives the test and leaves an open handle behind.
 *
 * A failing tick is logged and never crashes the interval or the process — the next tick still
 * fires on schedule regardless of whether the previous one succeeded.
 *
 * Returns a stop function; server.ts calls it during shutdown so the timer doesn't keep the
 * process alive on its own once every other resource has already been closed.
 */
export function startStaleOrderReminderJob(): () => void {
  const intervalMs = env.STALE_ORDER_REMINDER_CHECK_INTERVAL_MINUTES * 60 * 1000;

  async function tick(): Promise<void> {
    try {
      const { remindedOrderIds } = await sendStaleOrderReminders(env.STALE_ORDER_REMINDER_THRESHOLD_MINUTES);
      if (remindedOrderIds.length > 0) {
        logger.info('[stale-order-reminder] sent reminders', { count: remindedOrderIds.length });
      }
    } catch (err) {
      logger.error('[stale-order-reminder] tick failed', err);
    }
  }

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  // Never keeps the process alive on its own — a clean shutdown that for any reason doesn't reach
  // the explicit clearInterval below (see the stop function) still exits normally instead of
  // hanging on this timer.
  timer.unref();

  logger.info('[stale-order-reminder] job started', {
    thresholdMinutes: env.STALE_ORDER_REMINDER_THRESHOLD_MINUTES,
    checkIntervalMinutes: env.STALE_ORDER_REMINDER_CHECK_INTERVAL_MINUTES,
  });

  return () => {
    clearInterval(timer);
    logger.info('[stale-order-reminder] job stopped');
  };
}
