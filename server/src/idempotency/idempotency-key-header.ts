import type { Request } from 'express';
import { AppError } from '../utils/app-error';
import { ErrorCode } from '../errors/error-codes';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/** Same safe-charset allowlist and length bound as request-id.ts's X-Request-ID validation, for
 * the same reason: whatever a client sends ends up in a database row and (indirectly) in logs, so
 * it must be bounded and free of anything that could cause trouble downstream. */
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Reads the `Idempotency-Key` header, if present.
 *
 * - No header at all -> returns `undefined`. This is Case A from the Phase 2.6.7 spec: idempotency
 *   is opt-in per request, so the absence of the header must preserve the exact pre-existing
 *   behavior (create a new order every time), not silently invent a key or start deduplicating
 *   unrelated requests.
 * - A header that fails validation (empty, oversized, unsafe characters, or sent twice) throws a
 *   400 — unlike request-id.ts's X-Request-ID, which silently substitutes a fresh ID for an
 *   invalid one. Silently ignoring a malformed idempotency key here would be actively misleading:
 *   the client explicitly asked for a correctness guarantee that would then silently not apply.
 */
export function extractIdempotencyKeyHeader(req: Request): string | undefined {
  const header = req.headers[IDEMPOTENCY_KEY_HEADER];
  if (header === undefined) {
    return undefined;
  }

  const value = Array.isArray(header) ? undefined : header;
  if (value === undefined || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new AppError(
      400,
      `Idempotency-Key must be a single value, ${MAX_IDEMPOTENCY_KEY_LENGTH} characters or fewer, using only letters, numbers, '.', '_', or '-'.`,
      ErrorCode.INVALID_PARAMETER,
      { field: 'Idempotency-Key' },
    );
  }

  return value;
}
