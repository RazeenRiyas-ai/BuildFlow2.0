# Idempotency (Phase 2.6.7)

## 1. What idempotency means in BuildFlow

A client can safely repeat the same `POST /orders` request — because of a double tap, a mobile
network retry, a client timeout followed by a manual retry, or a proxy retrying an ambiguous
request — and the server guarantees it produces **at most one order**, no matter how many times
the request actually arrives. The client opts in per request by sending an `Idempotency-Key`
header; without it, behavior is unchanged from before this phase.

## 2. Why `POST /orders` needs it

It's the one endpoint in the app that creates a real, billable, operationally-visible business
record from a mobile client over an unreliable network. A contractor who taps "Submit" once but
whose network hiccups mid-request must never end up with two orders for one delivery.

## 3. Why the database, not memory

An in-memory map only protects a single process, only survives until the next restart or deploy,
and does nothing once BuildFlow runs more than one Node instance. Postgres is already this app's
durable coordination point (it's what makes refresh-token rotation and order state transitions
safe) — reusing it here means idempotency survives a restart and works correctly the moment a
second server process exists, with no new infrastructure.

## 4. How the unique constraint prevents races

`idempotency_keys` has a UNIQUE index on `(user_id, scope, idempotency_key)`. Two requests racing
on the same key both run `INSERT ... ON CONFLICT (...) DO NOTHING` inside their own transaction.
Postgres itself makes the second one **block** until the first transaction resolves — this isn't
application-level locking, it's how `INSERT ... ON CONFLICT` behaves against a conflicting row from
a still-open concurrent transaction. Once unblocked:

- if the first transaction **committed**, the second one's insert cleanly conflicts, inserts
  nothing, and falls through to read the (now guaranteed-committed) stored response;
- if the first transaction **rolled back**, the second one's insert proceeds as if there had been
  no conflict, and it becomes the new owner.

See `server/src/idempotency/idempotency-store.ts` for the exact query and a longer comment on this.

## 5. How retries work

1. Client generates one key for a submission attempt, sends `Idempotency-Key: <key>`.
2. Server hashes the validated request body (SHA-256 over canonical, key-sorted JSON — see
   `request-hash.ts`) and tries to claim `(user_id, scope, key)`.
3. **Claimed** → runs the operation, stores the exact response (status + body) in the same
   transaction, commits, returns that response.
4. **Not claimed, same hash** → the operation never runs again; the stored response is returned
   byte-for-byte (same order, same fields, no new resource, no re-triggered side effects like the
   HQ push notification).
5. **Not claimed, different hash** → `409 IDEMPOTENCY_KEY_REUSED`. This is a real client bug (reusing
   a key for a logically different request) and is reported as a normal application error, not
   silently ignored.

## 6. Same-key/different-payload conflicts

Detected by comparing the stored `request_hash` against a freshly computed one for the incoming
request. On mismatch, the server returns the existing flat error shape:

```json
{ "error": "This Idempotency-Key was already used with a different request", "code": "IDEMPOTENCY_KEY_REUSED", "requestId": "..." }
```

No new code path was added to the error *response* format — this is `AppError` +
`errors/error-codes.ts` + the existing `errorHandler.ts`, exactly like every other application
error.

## 7. What happens when a transaction rolls back

The idempotency claim is inserted in the **same transaction** as the operation it guards (see
`idempotency.ts`'s `runIdempotentOperation`). If the operation throws for any reason — a validation
failure, a business-rule rejection, an unexpected database error — the whole transaction rolls
back, taking the claim row with it. There is no separate cleanup step and no `'failed'` status:
the key is simply available again, exactly as if it had never been used, and a retry with the same
key runs the operation fresh.

## 8. How frontend keys are generated

`src/utils/generate-idempotency-key.ts` produces a client-side key (timestamp + random hex, not a
secret, not cryptographically sensitive — it only needs to be practically unique per attempt).
`src/app/order/review.tsx` generates **one** key per submission attempt, in a ref that survives
across a failed attempt's retry (via the existing error banner's "retry" action) and is cleared
only after a successful submit. `api-client.post` accepts an optional `headers` override so only
`orders-service.ts`'s `submitOrder(input, idempotencyKey)` opts in — nothing else, and nothing is
generated automatically for other POST calls.

## 9. Which endpoints currently support idempotency

Only `POST /orders` (scope `orders.create`).

## 10. How a future mutation endpoint should opt in

1. Add a new scope constant to `IDEMPOTENCY_SCOPES` in `server/src/idempotency/idempotency.ts`.
2. In the controller, call `extractIdempotencyKeyHeader(req)` (returns `undefined` if the client
   sent none — that's fine, it means this specific call isn't deduplicated).
3. In the service, wrap the existing transactional logic in `runIdempotentOperation({ userId, scope,
   idempotencyKey, requestPayload }, async (client) => { ...; return { responseStatus, body,
   resourceId }; })` instead of calling `withTransaction` directly.
4. Make sure `body` is the exact shape you want replayed verbatim — build it inside the operation
   callback, not in the controller, since it must be stored in the same transaction that creates
   the resource.
5. Never include the resource's *current* state in what you store if the operation could be
   retried after the resource has since changed elsewhere — store what this specific call
   produced, not what a later re-fetch would show.

## Cleanup (not yet scheduled)

`idempotency_keys.expires_at` defaults to 7 days from creation and is indexed
(`idempotency_keys_expires_at_idx`) specifically so a periodic job can run:

```sql
DELETE FROM idempotency_keys WHERE expires_at < now();
```

No such job exists yet — there's no background scheduler in this app to hang it on. When one is
introduced (a cron-triggered endpoint, a scheduled task runner, whatever the ops setup ends up
being), point it at this query. Until then, the table will grow unbounded but slowly (one row per
idempotent request), which is an acceptable, documented trade-off at current scale.

## Security notes

- The idempotency key is **never** an authentication mechanism — `requireAuth`/`requireRole`
  already run before the controller ever looks at the header, exactly as for every other request.
- A key string is only ever looked up scoped to `(user_id, scope, key)`; one user can never read or
  replay another user's stored response, even if they happen to send the identical key string.
- `scope` is a server-defined constant, never taken from the client, so one operation can never
  collide with another's keys even if a client reused a key value across different endpoints.
- The request hash is computed server-side from the already-validated body; a client cannot forge
  or influence what gets hashed beyond the fields it's already allowed to submit.
