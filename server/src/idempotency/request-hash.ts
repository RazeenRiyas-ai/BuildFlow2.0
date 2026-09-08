import crypto from 'node:crypto';

/**
 * Recursively sorts object keys (arrays keep their order — order is semantically significant
 * there) so that two logically-identical request bodies produce byte-identical JSON regardless of
 * property insertion order. `JSON.stringify` alone is not enough: it preserves whatever key order
 * the object happens to have, which for a plain object built from parsed JSON depends on how the
 * client serialized it, not on the field values themselves.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const out: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * A SHA-256 fingerprint of the logical request payload — used to detect "same Idempotency-Key,
 * different request" (see idempotency.ts). Callers must pass only the fields relevant to the
 * operation (e.g. the already-validated body), never raw headers, auth tokens, or credentials —
 * the authenticated user is already part of the idempotency scope (user_id, scope, key), not part
 * of this hash.
 */
export function computeRequestHash(payload: unknown): string {
  const canonicalJson = JSON.stringify(canonicalize(payload));
  return crypto.createHash('sha256').update(canonicalJson).digest('hex');
}
