/* eslint-disable */
exports.shorthands = undefined;

// Durable, database-backed idempotency for mutating endpoints (starting with POST /orders). See
// server/docs/idempotency.md for the full design rationale. In short:
//
// - Scoped ownership: the UNIQUE index is on (user_id, scope, idempotency_key), not on
//   idempotency_key alone — two different users (or two different operations) may legitimately
//   reuse the same key string without colliding.
// - request_hash lets the application detect "same key, different payload" and reject it instead
//   of silently replaying a mismatched response.
// - response_status/response_body store the exact response that was returned the first time, so a
//   retry can replay it byte-for-byte rather than recomputing anything.
// - Concurrency safety comes from the UNIQUE index itself plus Postgres's own behavior for
//   INSERT ... ON CONFLICT against a row still owned by another in-flight transaction (it blocks
//   until that transaction resolves) — not from any application-level locking.
// - Deliberately no 'failed' status: the claim row is inserted in the SAME transaction as the
//   operation it guards, so if that operation's transaction rolls back (a transient DB error, a
//   validation failure, anything), the claim row rolls back with it — there is nothing to clean up
//   and no permanently stuck 'in_progress' row is possible in normal operation.
exports.up = (pgm) => {
  pgm.sql(`CREATE TYPE idempotency_status AS ENUM ('in_progress', 'completed');`);

  pgm.sql(`
    CREATE TABLE idempotency_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scope TEXT NOT NULL CHECK (char_length(scope) > 0),
      idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
      request_hash TEXT NOT NULL,
      status idempotency_status NOT NULL DEFAULT 'in_progress',
      response_status INTEGER,
      response_body JSONB,
      resource_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days')
    );
  `);

  // The unique ownership constraint the whole design leans on for concurrency safety (see above).
  pgm.sql(`
    CREATE UNIQUE INDEX idempotency_keys_user_scope_key_idx
      ON idempotency_keys (user_id, scope, idempotency_key);
  `);

  // Supports a future cleanup job (DELETE FROM idempotency_keys WHERE expires_at < now()) — not
  // scheduled yet; see server/docs/idempotency.md's "Cleanup" section for the intended follow-up.
  pgm.sql(`CREATE INDEX idempotency_keys_expires_at_idx ON idempotency_keys (expires_at);`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS idempotency_keys;`);
  pgm.sql(`DROP TYPE IF EXISTS idempotency_status;`);
};
