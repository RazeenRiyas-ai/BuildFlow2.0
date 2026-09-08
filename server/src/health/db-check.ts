import { pool } from '../config/db';

/** Structural, not the concrete pg.Pool type — same reasoning as graceful-shutdown.ts's
 * ClosablePool: lets a test substitute a minimal fake that fails on demand, without touching or
 * destroying the real shared pool that every other test file also depends on. */
export interface QueryableDatabase {
  query(text: string): Promise<unknown>;
}

const DEFAULT_TIMEOUT_MS = 2000;

/**
 * The one dependency readiness actually cares about: can we reach Postgres right now? `SELECT 1`
 * is the cheapest possible round-trip — no application table is touched, per Phase 2.6.6's scope.
 *
 * Bounded by a timeout (default 2s) so a half-dead database (accepting the TCP connection but
 * never responding, rather than cleanly refusing) can't make /health/ready hang indefinitely —
 * that would defeat the entire point of a readiness probe an orchestrator polls on a tight loop.
 * This does not touch the shared pool's own configuration; it only bounds how long THIS caller is
 * willing to wait for it.
 */
export async function checkDatabaseConnectivity(
  db: QueryableDatabase = pool,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  let timeoutTimer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      db.query('SELECT 1'),
      new Promise((_, reject) => {
        timeoutTimer = setTimeout(() => reject(new Error('readiness database check timed out')), timeoutMs);
      }),
    ]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  } finally {
    // Prevents a fast, successful check from leaving a stray timer alive for up to `timeoutMs` —
    // harmless in production but avoids holding the event loop open unnecessarily under frequent
    // polling, and avoids a lingering timer delaying test-process exit.
    clearTimeout(timeoutTimer);
  }
}
