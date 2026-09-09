import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db';
import { env } from '../config/env';
import type { AccessTokenPayload, UserRole } from '../types/auth';

export async function deleteUserByPhone(phone: string) {
  await pool.query('DELETE FROM users WHERE phone = $1', [phone]);
}

export function uniquePhone(): string {
  return `+91 ${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 20);
}

/** Signs a token by the exact same payload shape/secret requireAuth verifies against (see
 * middleware/auth.ts, auth.service.ts's signAccessToken) for an already-existing user — e.g. the
 * seeded HQ admin — without going through the rate-limited POST /auth/login endpoint. */
export function signTestAccessToken(userId: string, role: UserRole): string {
  const payload: AccessTokenPayload = { sub: userId, role };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
}

/**
 * Creates a real contractor row (users + contractors) directly via SQL and mints a matching access
 * token — a real, valid session, without going through the rate-limited POST /auth/register
 * endpoint.
 *
 * For test files that need several throwaway authenticated contractors purely as fixtures (push
 * token owners, order owners, ...) and aren't themselves testing registration/login — going through
 * /auth/register for every one of them adds up against authRateLimit's 10-per-60s ceiling well
 * before any single test file's actual number of *meaningful* auth assertions would, since that
 * limiter is shared process-wide across every test in a run, not reset per file/describe block.
 */
export async function createContractorSession(name: string, phone: string): Promise<{ userId: string; accessToken: string }> {
  const passwordHash = await bcrypt.hash('password123', 10);
  const userResult = await pool.query<{ id: string }>(`INSERT INTO users (role, phone, password_hash) VALUES ('contractor', $1, $2) RETURNING id`, [
    phone,
    passwordHash,
  ]);
  const userId = userResult.rows[0].id;
  await pool.query(`INSERT INTO contractors (id, name, phone) VALUES ($1, $2, $3)`, [userId, name, phone]);

  return { userId, accessToken: signTestAccessToken(userId, 'contractor') };
}
