import type { PoolClient } from 'pg';

export interface ClaimIdempotencyKeyParams {
  userId: string;
  scope: string;
  idempotencyKey: string;
  requestHash: string;
}

export type ClaimResult =
  | { claimed: true; id: string }
  | {
      claimed: false;
      existing: { requestHash: string; status: 'in_progress' | 'completed'; responseStatus: number | null; responseBody: unknown };
    };

/**
 * Attempts to become the sole owner of (user_id, scope, idempotency_key) for this request.
 *
 * Concurrency safety comes entirely from Postgres here, not from application logic: when two
 * transactions race to INSERT the same unique key, the second one to arrive at this statement
 * BLOCKS until the first one commits or rolls back (this is standard Postgres behavior for
 * INSERT ... ON CONFLICT against a row from a still-open concurrent transaction — not something
 * this code has to implement). Once unblocked:
 *   - if the first transaction committed, our own INSERT sees a real conflict, inserts nothing,
 *     and the caller must fall through to inspect the now-guaranteed-committed existing row;
 *   - if the first transaction rolled back, our INSERT proceeds exactly as if there had been no
 *     conflict at all, and we become the new owner.
 * This is also why a transaction that fails after claiming never leaves a permanently stuck
 * 'in_progress' row: the claim INSERT lives in the SAME transaction as the operation it guards
 * (see idempotency.ts), so a rollback undoes the claim along with everything else.
 */
export async function claimIdempotencyKey(client: PoolClient, params: ClaimIdempotencyKeyParams): Promise<ClaimResult> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO idempotency_keys (user_id, scope, idempotency_key, request_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, scope, idempotency_key) DO NOTHING
     RETURNING id`,
    [params.userId, params.scope, params.idempotencyKey, params.requestHash],
  );

  if (inserted.rows[0]) {
    return { claimed: true, id: inserted.rows[0].id };
  }

  // No row returned means a conflicting row already exists AND (per the blocking behavior above)
  // is guaranteed to belong to a transaction that has already resolved — never one still in
  // flight. In normal operation this row's status will always be 'completed'; see
  // idempotency.ts's defensive handling of the (should-be-impossible) alternative.
  const existingResult = await client.query<{
    request_hash: string;
    status: 'in_progress' | 'completed';
    response_status: number | null;
    response_body: unknown;
  }>(
    `SELECT request_hash, status, response_status, response_body
     FROM idempotency_keys
     WHERE user_id = $1 AND scope = $2 AND idempotency_key = $3`,
    [params.userId, params.scope, params.idempotencyKey],
  );
  const existing = existingResult.rows[0];

  return {
    claimed: false,
    existing: {
      requestHash: existing.request_hash,
      status: existing.status,
      responseStatus: existing.response_status,
      responseBody: existing.response_body,
    },
  };
}

export interface CompleteIdempotencyKeyParams {
  id: string;
  responseStatus: number;
  responseBody: unknown;
  resourceId?: string;
}

/** Marks a claimed key as completed with the exact response to replay on a future retry. Must be
 * called on the same `client`/transaction that performed the operation, before that transaction
 * commits — see runIdempotentOperation in idempotency.ts, which is the only intended caller. */
export async function completeIdempotencyKey(client: PoolClient, params: CompleteIdempotencyKeyParams): Promise<void> {
  await client.query(
    `UPDATE idempotency_keys
     SET status = 'completed', response_status = $1, response_body = $2, resource_id = $3, completed_at = now()
     WHERE id = $4`,
    [params.responseStatus, JSON.stringify(params.responseBody), params.resourceId ?? null, params.id],
  );
}
