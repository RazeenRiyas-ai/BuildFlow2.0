export type UserRole = 'contractor' | 'hq_staff' | 'hq_admin';

export interface AccessTokenPayload {
  sub: string; // users.id
  role: UserRole;
}

/** tokenVersion is only ever compared during /auth/refresh (see auth.service.ts) — never on the
 * access-token verification path, which stays a pure, DB-free signature/expiry check.
 *
 * jti exists purely to make every signed refresh token a unique string: `jwt.sign` is otherwise
 * deterministic given the same payload/secret/expiry, and `iat` only has 1-second resolution — two
 * logins (or refreshes) for the same user within the same second would otherwise produce
 * byte-identical tokens, colliding on the refresh_tokens.token_hash UNIQUE constraint. */
export interface RefreshTokenPayload {
  sub: string; // users.id
  role: UserRole;
  tokenVersion: number;
  jti: string;
}
