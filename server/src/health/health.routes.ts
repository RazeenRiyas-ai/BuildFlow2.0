import { Router, type Request, type Response } from 'express';
import { checkDatabaseConnectivity, type QueryableDatabase } from './db-check';
import { isShuttingDown } from './readiness-state';
import { logger } from '../utils/logger';

/** Infrastructure endpoints must never be served from a cache — a stale "ready" or "alive" is
 * actively dangerous (a load balancer would keep routing traffic to a draining/dead instance). */
function noStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
}

export interface CreateHealthRouterOptions {
  /** Overridable so a test can inject a database that fails on demand — see db-check.ts — without
   * ever touching or closing the real shared pool that other tests still depend on. Defaults to
   * the real shared pool (config/db.ts) in production. */
  db?: QueryableDatabase;
  /** Overridable so a test doesn't have to wait out the real timeout to exercise the failure path. */
  dbCheckTimeoutMs?: number;
}

/**
 * Liveness and readiness are deliberately two different questions (see Phase 2.6.6):
 *
 * GET /health/live  — is this Node process alive at all? Never touches Postgres. As long as
 *   Express can run this handler, the process is alive by definition, so this can only ever
 *   return 200 — there's nothing else for it to check.
 *
 * GET /health/ready — can this process currently serve real application traffic? First checks
 *   whether graceful shutdown has begun (readiness-state.ts) — a shutting-down process must stop
 *   receiving new traffic immediately, and that's true regardless of Postgres's own health, so it
 *   is checked first and short-circuits without touching the database at all. Otherwise performs a
 *   fresh, on-demand `SELECT 1` (db-check.ts) — the current instant's real answer, not a cached
 *   flag, so a temporary database outage (and its later recovery) is reflected immediately on the
 *   very next request. No separate "has startup finished" flag is layered on top of that: a
 *   database that isn't reachable yet at boot fails this exact same live check anyway, which
 *   already produces the desired STARTING -> READY transition once Postgres becomes reachable,
 *   without an extra piece of state that could ever drift out of sync with reality.
 *
 * Neither response body ever includes a hostname, connection string, credential, SQL error, or
 * stack trace — both are intentionally tiny and infrastructure-shaped, not run through the normal
 * application error taxonomy (Phase 2.6.5), which exists for client-facing business errors.
 */
export function createHealthRouter(options: CreateHealthRouterOptions = {}): Router {
  const router = Router();

  router.get('/live', (_req: Request, res: Response) => {
    noStore(res);
    res.status(200).json({ status: 'ok' });
  });

  router.get('/ready', async (_req: Request, res: Response) => {
    noStore(res);

    if (isShuttingDown()) {
      res.status(503).json({ status: 'unavailable' });
      return;
    }

    const result = await checkDatabaseConnectivity(options.db, options.dbCheckTimeoutMs);
    if (result.ok) {
      res.status(200).json({ status: 'ok' });
      return;
    }

    const error = result.error;
    logger.warn('Readiness check failed', {
      dependency: 'postgres',
      errorName: error instanceof Error ? error.name : 'NonError',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    res.status(503).json({ status: 'unavailable' });
  });

  return router;
}
