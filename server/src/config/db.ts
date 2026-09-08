import { Pool, type QueryResultRow } from 'pg';
import { env } from './env';
import { logger } from '../utils/logger';

export const pool = new Pool({ connectionString: env.DATABASE_URL });

/**
 * pg.Pool emits 'error' when an already-idle client hits a connection-level problem (the database
 * restarting, a network blip, a TCP reset) — completely independent of any in-flight query. Pool
 * already discards the broken client internally; the only consequence of leaving this unhandled is
 * that Node's EventEmitter throws on an 'error' event with zero listeners, which would crash
 * whichever process happens to be using this pool (the real server, or a test run) over a
 * transient blip that was never actually fatal. This listener's only job is to make that failure
 * visible instead of silently swallowed — never log-and-retry logic, never state to manage.
 *
 * Logged at 'warn' rather than 'error': the pool has already discarded the broken client and the
 * process keeps serving requests normally — this is exactly the "recoverable/unexpected" case, not
 * a failed operation in its own right.
 */
pool.on('error', (err) => {
  logger.warn('[db] pool error on an idle client (connection discarded, process continues)', {
    errorName: err.name,
    errorMessage: err.message,
  });
});

export function query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) {
  return pool.query<T>(text, params);
}

export async function withTransaction<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
