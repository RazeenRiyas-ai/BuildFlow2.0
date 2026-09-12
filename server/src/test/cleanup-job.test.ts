import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { pool } from '../config/db';
import { runExpiredRowCleanup } from '../modules/maintenance/cleanup.service';
import { createContractorSession, deleteUserByPhone, uniquePhone } from './db-helpers';

/**
 * runExpiredRowCleanup (Phase 3.9) is tested directly against real rows inserted via raw SQL — the
 * one piece of state (precise expires_at/revoked_at/replaced_by values) that no API call can set
 * directly. Mirrors stale-order-reminders.test.ts's own convention for the same reason.
 */
describe('runExpiredRowCleanup (Phase 3.9 cleanup job)', () => {
  const phone = uniquePhone();
  let userId: string;
  const idempotencyKeyIds: string[] = [];
  const refreshTokenIds: string[] = [];

  async function insertIdempotencyKey(expiresAtHoursFromNow: number): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO idempotency_keys (user_id, scope, idempotency_key, request_hash, status, expires_at)
       VALUES ($1, 'test-scope', $2, 'test-hash', 'completed', now() + make_interval(hours => $3::int))
       RETURNING id`,
      [userId, `cleanup-test-${Math.random()}`, expiresAtHoursFromNow],
    );
    const id = result.rows[0].id;
    idempotencyKeyIds.push(id);
    return id;
  }

  async function insertRefreshToken(opts: {
    expiresAtHoursFromNow: number;
    revoked?: boolean;
    replacedByAnotherToken?: boolean;
  }): Promise<string> {
    let replacedById: string | null = null;
    if (opts.replacedByAnotherToken) {
      // A distinct token this row points to via replaced_by — its own lifecycle is irrelevant to
      // the row under test, it only needs to exist to satisfy the FK.
      const other = await pool.query<{ id: string }>(
        `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
         VALUES ($1, $2, gen_random_uuid(), now() + interval '1 day') RETURNING id`,
        [userId, `other-hash-${Math.random()}`],
      );
      replacedById = other.rows[0].id;
      refreshTokenIds.push(replacedById);
    }

    const result = await pool.query<{ id: string }>(
      `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, revoked_at, replaced_by)
       VALUES ($1, $2, gen_random_uuid(), now() + make_interval(hours => $3::int), $4, $5)
       RETURNING id`,
      [userId, `hash-${Math.random()}`, opts.expiresAtHoursFromNow, opts.revoked ? new Date() : null, replacedById],
    );
    const id = result.rows[0].id;
    refreshTokenIds.push(id);
    return id;
  }

  async function idempotencyKeyExists(id: string): Promise<boolean> {
    const res = await pool.query('SELECT 1 FROM idempotency_keys WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }

  async function refreshTokenExists(id: string): Promise<boolean> {
    const res = await pool.query('SELECT 1 FROM refresh_tokens WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }

  beforeAll(async () => {
    const session = await createContractorSession('Cleanup Job Tester', phone);
    userId = session.userId;
  });

  afterAll(async () => {
    if (refreshTokenIds.length > 0) {
      await pool.query('DELETE FROM refresh_tokens WHERE id = ANY($1::uuid[])', [refreshTokenIds]);
    }
    if (idempotencyKeyIds.length > 0) {
      await pool.query('DELETE FROM idempotency_keys WHERE id = ANY($1::uuid[])', [idempotencyKeyIds]);
    }
    await deleteUserByPhone(phone);
  });

  it('deletes an expired idempotency_keys row', async () => {
    const id = await insertIdempotencyKey(-1);
    const result = await runExpiredRowCleanup();
    expect(result.idempotencyKeysDeleted).toBeGreaterThanOrEqual(1);
    expect(await idempotencyKeyExists(id)).toBe(false);
  });

  it('does not delete a non-expired idempotency_keys row', async () => {
    const id = await insertIdempotencyKey(1);
    await runExpiredRowCleanup();
    expect(await idempotencyKeyExists(id)).toBe(true);
  });

  it('deletes an expired refresh_tokens row', async () => {
    const id = await insertRefreshToken({ expiresAtHoursFromNow: -1 });
    const result = await runExpiredRowCleanup();
    expect(result.refreshTokensDeleted).toBeGreaterThanOrEqual(1);
    expect(await refreshTokenExists(id)).toBe(false);
  });

  it('never deletes a non-expired (active) refresh_tokens row', async () => {
    const id = await insertRefreshToken({ expiresAtHoursFromNow: 1 });
    await runExpiredRowCleanup();
    expect(await refreshTokenExists(id)).toBe(true);
  });

  it('does not delete a revoked-but-not-yet-expired refresh_tokens row (conservative criteria)', async () => {
    const id = await insertRefreshToken({ expiresAtHoursFromNow: 1, revoked: true });
    await runExpiredRowCleanup();
    expect(await refreshTokenExists(id)).toBe(true);
  });

  it('does not delete a replaced-but-not-yet-expired refresh_tokens row (conservative criteria)', async () => {
    const id = await insertRefreshToken({ expiresAtHoursFromNow: 1, replacedByAnotherToken: true });
    await runExpiredRowCleanup();
    expect(await refreshTokenExists(id)).toBe(true);
  });

  it('deletes an expired refresh_tokens row even if it was also revoked', async () => {
    const id = await insertRefreshToken({ expiresAtHoursFromNow: -1, revoked: true });
    await runExpiredRowCleanup();
    expect(await refreshTokenExists(id)).toBe(false);
  });

  it('is idempotent and restart-safe: a second consecutive call finds nothing left for rows already cleaned', async () => {
    const id = await insertIdempotencyKey(-1);
    const first = await runExpiredRowCleanup();
    expect(first.idempotencyKeysDeleted).toBeGreaterThanOrEqual(1);
    expect(await idempotencyKeyExists(id)).toBe(false);

    // A second call (simulating the next tick, or a fresh process after a restart — this function
    // holds no in-memory state between calls) must not error and must not "re-delete" anything;
    // the count reflects only whatever is expired *now*, which no longer includes this row.
    const second = await runExpiredRowCleanup();
    expect(second.idempotencyKeysDeleted).toBe(0);
  });

  it("never throws, and still cleans the other table, if one table's deletion fails", async () => {
    const expiredIdempotencyKeyId = await insertIdempotencyKey(-1);
    const expiredRefreshTokenId = await insertRefreshToken({ expiresAtHoursFromNow: -1 });
    const originalQuery = pool.query.bind(pool);
    const spy = vi.spyOn(pool, 'query').mockImplementation(((text: unknown, ...rest: unknown[]) => {
      if (typeof text === 'string' && text.includes('DELETE FROM idempotency_keys')) {
        return Promise.reject(new Error('simulated idempotency_keys failure'));
      }
      return (originalQuery as (...a: unknown[]) => unknown)(text, ...rest);
    }) as typeof pool.query);

    try {
      // Must resolve, never reject, even though one of its two internal deletes rejects.
      const outcome = await runExpiredRowCleanup();
      expect(outcome.idempotencyKeysDeleted).toBe(0);
      expect(outcome.refreshTokensDeleted).toBeGreaterThanOrEqual(1);
      // The failing table's row is untouched (query never actually ran)...
      expect(await idempotencyKeyExists(expiredIdempotencyKeyId)).toBe(true);
      // ...while the healthy table's cleanup still completed normally despite the other failing.
      expect(await refreshTokenExists(expiredRefreshTokenId)).toBe(false);
    } finally {
      spy.mockRestore();
    }

    // Confirms cleanup failure cannot crash the API process: the mocked failure above was thrown
    // from inside pool.query itself, deep inside runExpiredRowCleanup, and the process (and this
    // test run) is still alive to reach this line and clean the leftover row normally now that the
    // mock is restored.
    await runExpiredRowCleanup();
    expect(await idempotencyKeyExists(expiredIdempotencyKeyId)).toBe(false);
  });
});
