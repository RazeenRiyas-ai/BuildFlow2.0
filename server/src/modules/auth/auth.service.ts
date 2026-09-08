import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { pool, withTransaction } from '../../config/db';
import { ConflictError, UnauthorizedError } from '../../utils/app-error';
import { ErrorCode } from '../../errors/error-codes';
import type { AccessTokenPayload, RefreshTokenPayload, UserRole } from '../../types/auth';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '30d';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface RegisterContractorInput {
  name: string;
  companyName?: string;
  phone: string;
  password: string;
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function signAccessToken(userId: string, role: UserRole): string {
  const payload: AccessTokenPayload = { sub: userId, role };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

function signRefreshToken(userId: string, role: UserRole, tokenVersion: number): string {
  const payload: RefreshTokenPayload = { sub: userId, role, tokenVersion, jti: crypto.randomUUID() };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_TTL });
}

interface Queryable {
  query(text: string, params?: unknown[]): Promise<unknown>;
}

/** Inserts the first row of a brand-new rotation chain (a fresh login/register always starts its
 * own family, independent of any other session the user has open elsewhere). */
async function insertRefreshTokenRow(client: Queryable, userId: string, refreshToken: string, familyId: string) {
  await client.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at) VALUES ($1, $2, $3, $4)',
    [userId, hashToken(refreshToken), familyId, new Date(Date.now() + REFRESH_TOKEN_TTL_MS)],
  );
}

export async function registerContractor(input: RegisterContractorInput) {
  const existing = await pool.query('SELECT id FROM users WHERE phone = $1', [input.phone]);
  if (existing.rowCount) {
    throw new ConflictError('An account with this phone number already exists', ErrorCode.PHONE_ALREADY_REGISTERED);
  }

  const passwordHash = await bcrypt.hash(input.password, 10);

  return withTransaction(async (client) => {
    const userRow = await client.query<{ id: string }>(
      `INSERT INTO users (role, phone, password_hash) VALUES ('contractor', $1, $2) RETURNING id`,
      [input.phone, passwordHash],
    );
    const userId = userRow.rows[0].id;

    await client.query(
      `INSERT INTO contractors (id, name, company_name, phone) VALUES ($1, $2, $3, $4)`,
      [userId, input.name, input.companyName ?? null, input.phone],
    );

    const role: UserRole = 'contractor';
    const accessToken = signAccessToken(userId, role);
    const refreshToken = signRefreshToken(userId, role, 0);
    await insertRefreshTokenRow(client, userId, refreshToken, crypto.randomUUID());

    return { user: { id: userId, role }, accessToken, refreshToken };
  });
}

export async function login(phone: string, password: string) {
  const result = await pool.query<{
    id: string;
    role: UserRole;
    password_hash: string;
    is_active: boolean;
    token_version: number;
  }>('SELECT id, role, password_hash, is_active, token_version FROM users WHERE phone = $1', [phone]);
  const row = result.rows[0];
  if (!row) {
    throw new UnauthorizedError('Invalid phone number or password', ErrorCode.INVALID_CREDENTIALS);
  }

  const passwordMatches = await bcrypt.compare(password, row.password_hash);
  if (!passwordMatches) {
    throw new UnauthorizedError('Invalid phone number or password', ErrorCode.INVALID_CREDENTIALS);
  }

  // Checked only after the password is confirmed correct, so a disabled account's status is never
  // revealed to someone who doesn't already know the password.
  if (!row.is_active) {
    throw new UnauthorizedError('This account has been disabled', ErrorCode.ACCOUNT_DISABLED);
  }

  const accessToken = signAccessToken(row.id, row.role);
  const refreshToken = signRefreshToken(row.id, row.role, row.token_version);
  await insertRefreshTokenRow(pool, row.id, refreshToken, crypto.randomUUID());

  return { user: { id: row.id, role: row.role }, accessToken, refreshToken };
}

type RefreshOutcome =
  | { kind: 'ok'; accessToken: string; refreshToken: string }
  | { kind: 'invalid' }
  | { kind: 'revoked' }
  | { kind: 'reused' }
  | { kind: 'account_not_found' }
  | { kind: 'account_disabled' }
  | { kind: 'session_invalidated' };

export async function refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
  let payload: RefreshTokenPayload;
  try {
    payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
  } catch {
    throw new UnauthorizedError('Invalid or expired refresh token', ErrorCode.REFRESH_TOKEN_INVALID);
  }

  const tokenHash = hashToken(refreshToken);

  // The entire read-validate-rotate sequence runs under one row lock (FOR UPDATE) so that two
  // concurrent refresh attempts presenting the *same* token can never both succeed: the second
  // transaction blocks until the first commits, then correctly sees the row as already
  // rotated-away and takes the reuse-detection path. This is what makes rotation safe against a
  // captured-and-replayed refresh token, not just against accidental double-use.
  const outcome = await withTransaction<RefreshOutcome>(async (client) => {
    const rowResult = await client.query<{
      id: string;
      user_id: string;
      family_id: string;
      revoked_at: Date | null;
      replaced_by: string | null;
      expires_at: Date;
    }>(
      'SELECT id, user_id, family_id, revoked_at, replaced_by, expires_at FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE',
      [tokenHash],
    );
    const row = rowResult.rows[0];
    if (!row) {
      return { kind: 'invalid' };
    }

    if (row.replaced_by) {
      // This exact token was already exchanged for a newer one, and is being presented again —
      // the strongest available signal that a copy of it is circulating outside this client. Kill
      // every token in the chain, not just this one.
      await client.query(
        'UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL',
        [row.family_id],
      );
      return { kind: 'reused' };
    }

    if (row.revoked_at) {
      // Revoked directly (e.g. logout) and never rotated onward — dead, but not itself evidence of
      // theft, so no need to cascade a family-wide revocation here.
      return { kind: 'revoked' };
    }

    if (row.expires_at.getTime() < Date.now()) {
      return { kind: 'invalid' };
    }

    const userResult = await client.query<{
      id: string;
      role: UserRole;
      is_active: boolean;
      token_version: number;
    }>('SELECT id, role, is_active, token_version FROM users WHERE id = $1', [row.user_id]);
    const user = userResult.rows[0];
    if (!user) {
      return { kind: 'account_not_found' };
    }
    if (!user.is_active) {
      return { kind: 'account_disabled' };
    }
    if (payload.tokenVersion !== user.token_version) {
      return { kind: 'session_invalidated' };
    }

    const newAccessToken = signAccessToken(user.id, user.role);
    const newRefreshToken = signRefreshToken(user.id, user.role, user.token_version);
    const newRowResult = await client.query<{ id: string }>(
      'INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at) VALUES ($1, $2, $3, $4) RETURNING id',
      [user.id, hashToken(newRefreshToken), row.family_id, new Date(Date.now() + REFRESH_TOKEN_TTL_MS)],
    );
    await client.query('UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $1 WHERE id = $2', [
      newRowResult.rows[0].id,
      row.id,
    ]);

    return { kind: 'ok', accessToken: newAccessToken, refreshToken: newRefreshToken };
  });

  switch (outcome.kind) {
    case 'ok':
      return { accessToken: outcome.accessToken, refreshToken: outcome.refreshToken };
    case 'reused':
      throw new UnauthorizedError('Refresh token has already been used', ErrorCode.REFRESH_TOKEN_REUSED);
    case 'revoked':
      throw new UnauthorizedError('Refresh token has been revoked', ErrorCode.REFRESH_TOKEN_REVOKED);
    case 'account_not_found':
      throw new UnauthorizedError('Account no longer exists', ErrorCode.ACCOUNT_NOT_FOUND);
    case 'account_disabled':
      throw new UnauthorizedError('This account has been disabled', ErrorCode.ACCOUNT_DISABLED);
    case 'session_invalidated':
      throw new UnauthorizedError('Session has been invalidated', ErrorCode.SESSION_INVALIDATED);
    case 'invalid':
    default:
      throw new UnauthorizedError('Invalid or expired refresh token', ErrorCode.REFRESH_TOKEN_INVALID);
  }
}

/** Always succeeds (logout is idempotent): if the presented token doesn't hash-match any row —
 * already logged out, garbage input, whatever — there's simply nothing to revoke. */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const tokenHash = hashToken(refreshToken);
  await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [
    tokenHash,
  ]);
}
