import { pool } from '../../config/db';
import { logger } from '../../utils/logger';

export interface CleanupResult {
  idempotencyKeysDeleted: number;
  refreshTokensDeleted: number;
}

/**
 * Deletes rows past their own already-existing expiry, in the two tables documented to grow
 * unboundedly without this: idempotency_keys (see docs/idempotency.md's "Cleanup" section — this
 * function is exactly the query that doc calls for) and refresh_tokens
 * (1735530000000_refresh_token_sessions.js never scheduled a cleanup either).
 *
 * Criteria are deliberately just `expires_at < now()` for both tables, and nothing else — no
 * revocation-based or "replaced" based deletion. This can never delete a still-active session or a
 * still-valid idempotency claim: a row with a future expires_at has, by definition, not expired,
 * regardless of any other column (revoked_at, replaced_by, status). A revoked or
 * already-rotated-away refresh token is deliberately kept until its own original expiry passes
 * rather than removed immediately — preserving it for the reuse-detection window
 * auth.service.ts's rotation logic depends on (walking a token's family_id) for that token's full
 * natural lifetime, and for forensic visibility into a detected reuse attempt.
 *
 * Each table is cleaned independently, in its own try/catch, so a failure deleting from one table
 * never prevents the other from being cleaned in the same call — and so this function itself never
 * throws (see cleanup-job.ts's own doc comment for why a job tick must never crash the process).
 */
export async function runExpiredRowCleanup(): Promise<CleanupResult> {
  let idempotencyKeysDeleted = 0;
  try {
    const result = await pool.query('DELETE FROM idempotency_keys WHERE expires_at < now()');
    idempotencyKeysDeleted = result.rowCount ?? 0;
  } catch (err) {
    logger.error('[cleanup] idempotency_keys cleanup failed', err);
  }

  let refreshTokensDeleted = 0;
  try {
    const result = await pool.query('DELETE FROM refresh_tokens WHERE expires_at < now()');
    refreshTokensDeleted = result.rowCount ?? 0;
  } catch (err) {
    logger.error('[cleanup] refresh_tokens cleanup failed', err);
  }

  return { idempotencyKeysDeleted, refreshTokensDeleted };
}
