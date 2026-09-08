import type { PoolClient } from 'pg';
import { withTransaction } from '../config/db';
import { ConflictError } from '../utils/app-error';
import { ErrorCode } from '../errors/error-codes';
import { logger } from '../utils/logger';
import { computeRequestHash } from './request-hash';
import { claimIdempotencyKey, completeIdempotencyKey } from './idempotency-store';

/** Stable scope identifiers — one per operation that supports idempotency, not per HTTP
 * route/method (a route could be renamed without changing what the operation logically is). Add
 * a new entry here when a future mutation endpoint opts in (see server/docs/idempotency.md). */
export const IDEMPOTENCY_SCOPES = {
  ORDERS_CREATE: 'orders.create',
} as const;

export interface IdempotentOperationResult<TBody> {
  responseStatus: number;
  body: TBody;
  /** The primary resource this operation created, if any — stored alongside the response for
   * operator visibility/debugging, not used by the replay path itself (the full response body
   * already has everything needed to answer the client). */
  resourceId?: string;
}

export interface RunIdempotentOperationParams {
  userId: string;
  scope: string;
  /** `undefined` means the caller sent no Idempotency-Key header at all — Case A: run the
   * operation exactly as it behaved before idempotency existed, with no claim/replay logic at all. */
  idempotencyKey: string | undefined;
  /** The already-validated request payload the hash is computed from — never the raw request
   * object, headers, or anything containing auth credentials. */
  requestPayload: unknown;
}

/**
 * Runs `operation` with durable, database-backed idempotency semantics when `idempotencyKey` is
 * provided, or exactly as before (just wrapped in its own transaction) when it isn't.
 *
 * The claim, the operation itself, and storing the completed response all happen inside ONE
 * `withTransaction` call. This is deliberate, not incidental: it's what makes "a successful
 * idempotency record must never exist without its corresponding successful resource" and "a
 * transient failure must never permanently poison the key" both true at the same time, with no
 * separate cleanup step —
 *   - operation throws -> the whole transaction (claim included) rolls back -> the key is
 *     completely free for a future retry, and the original error propagates to the caller exactly
 *     as it would have without idempotency involved at all;
 *   - operation succeeds -> the claim is marked completed and committed together with whatever
 *     the operation itself wrote -> the two can never disagree.
 *
 * See idempotency-store.ts for how concurrent requests racing on the same key are made safe by
 * Postgres's own behavior around INSERT ... ON CONFLICT, rather than by any lock this code takes.
 */
export async function runIdempotentOperation<TBody>(
  params: RunIdempotentOperationParams,
  operation: (client: PoolClient) => Promise<IdempotentOperationResult<TBody>>,
): Promise<{ responseStatus: number; body: TBody; replayed: boolean }> {
  if (!params.idempotencyKey) {
    const result = await withTransaction((client) => operation(client));
    return { responseStatus: result.responseStatus, body: result.body, replayed: false };
  }

  const idempotencyKey = params.idempotencyKey;
  const requestHash = computeRequestHash(params.requestPayload);

  return withTransaction(async (client) => {
    const claim = await claimIdempotencyKey(client, {
      userId: params.userId,
      scope: params.scope,
      idempotencyKey,
      requestHash,
    });

    if (!claim.claimed) {
      if (claim.existing.status !== 'completed') {
        // Should not be reachable in normal operation — see claimIdempotencyKey's comments on why
        // a conflicting row is always already completed by the time it's observable here. Handled
        // defensively rather than assumed away, since "impossible" states are exactly the ones
        // worth a clear, safe error instead of an undefined one.
        throw new ConflictError('This request is already being processed', ErrorCode.IDEMPOTENCY_REQUEST_IN_PROGRESS);
      }

      if (claim.existing.requestHash !== requestHash) {
        throw new ConflictError(
          'This Idempotency-Key was already used with a different request',
          ErrorCode.IDEMPOTENCY_KEY_REUSED,
        );
      }

      logger.info('Idempotency key replayed', { scope: params.scope, userId: params.userId });
      return {
        responseStatus: claim.existing.responseStatus!,
        body: claim.existing.responseBody as TBody,
        replayed: true,
      };
    }

    const result = await operation(client);
    await completeIdempotencyKey(client, {
      id: claim.id,
      responseStatus: result.responseStatus,
      responseBody: result.body,
      resourceId: result.resourceId,
    });

    logger.info('Idempotency key claimed and completed', { scope: params.scope, userId: params.userId });
    return { responseStatus: result.responseStatus, body: result.body, replayed: false };
  });
}
