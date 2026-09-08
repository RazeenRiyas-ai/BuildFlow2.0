/**
 * Generates a client-side idempotency key for one logical mutation attempt (see
 * src/app/order/review.tsx, the only current caller). Deliberately not `crypto.randomUUID()`:
 * that isn't reliably available across every Hermes/JSC/web target this app runs on without a
 * native polyfill (expo-crypto), which would need a prebuild just for this. An idempotency key
 * only needs to be practically unique per submission attempt and safe for the server's validation
 * pattern (server/src/idempotency/idempotency-key-header.ts) — it is never treated as a secret or
 * an authentication credential, so `Math.random()` is perfectly sufficient here.
 */
export function generateIdempotencyKey(): string {
  const randomHex = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `order-${Date.now()}-${randomHex}`;
}
