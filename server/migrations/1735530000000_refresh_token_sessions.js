/* eslint-disable */
exports.shorthands = undefined;

// Adds real session state on top of the previously fully-stateless JWT auth:
// - users.is_active / users.token_version: explicit account/session invalidation switches,
//   checked only at /auth/refresh time (never on the hot per-request access-token path).
// - refresh_tokens: one row per issued refresh token, identified by a SHA-256 hash (never the
//   raw token). Rotation chains share a family_id; replaced_by links a token to the one that
//   replaced it, which is what makes reuse-of-an-already-rotated-token detectable.
exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;`);
  pgm.sql(`ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;`);

  pgm.sql(`
    CREATE TABLE refresh_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      family_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      replaced_by UUID REFERENCES refresh_tokens(id)
    );
  `);
  pgm.sql(`CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);`);
  pgm.sql(`CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS refresh_tokens;`);
  pgm.sql(`ALTER TABLE users DROP COLUMN IF EXISTS token_version;`);
  pgm.sql(`ALTER TABLE users DROP COLUMN IF EXISTS is_active;`);
};
