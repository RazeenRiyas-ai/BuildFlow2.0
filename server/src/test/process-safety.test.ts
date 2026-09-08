import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { execFile } from 'child_process';
import path from 'path';
import { pool } from '../config/db';

describe('Postgres pool error resilience', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has an error listener attached, so emitting one never throws', () => {
    // Node's EventEmitter throws synchronously when 'error' is emitted with zero listeners — a
    // non-throwing emit here is direct proof a listener is attached, which is exactly what stops
    // an idle-client connection error from crashing whichever process owns this pool.
    expect(pool.listenerCount('error')).toBeGreaterThan(0);

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => pool.emit('error', new Error('simulated idle-client connection error'))).not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

describe('process-level crash prevention (real subprocess)', () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'process-safety-fixture.ts');
  const tsxBin = path.join(__dirname, '..', '..', 'node_modules', '.bin', 'tsx');

  // Deliberately async (execFile, not execFileSync): a synchronous spawn would block this whole
  // worker's event loop for the subprocess's entire startup+run time, which — since vitest can run
  // multiple test files concurrently in the same worker — was observed to stall unrelated test
  // files' in-flight DB queries into timing out. An async spawn lets other tests keep running while
  // this one waits.
  function runFixture(mode: string): Promise<{ status: number; stderr: string }> {
    return new Promise((resolve) => {
      execFile(tsxBin, [fixturePath, mode], { timeout: 15000 }, (error, _stdout, stderr) => {
        if (!error) {
          resolve({ status: 0, stderr });
          return;
        }
        // execFile's error.code is the child's exit code (a number) when it ran and exited
        // non-zero, or an errno string (e.g. 'ENOENT') if the subprocess never started at all.
        const exitCode = typeof error.code === 'number' ? error.code : 1;
        resolve({ status: exitCode, stderr });
      });
    });
  }

  // Generous test-level timeout: spawning a real `tsx` subprocess involves real TypeScript
  // compilation, which can run noticeably slower under the CPU contention of a full parallel test
  // run than in isolation — this is about tolerating that variance, not masking a hang (the
  // subprocess's own `execFile` timeout above is the actual hang-detection bound).
  it('an uncaught exception is logged with context and exits with a non-zero code', async () => {
    const { status, stderr } = await runFixture('uncaughtException');
    expect(status).toBe(1);
    expect(stderr).toMatch(/\[fatal\] uncaught exception/);
    expect(stderr).toMatch(/deliberate uncaught exception/);
  }, 20000);

  it('an unhandled promise rejection is logged with context and exits with a non-zero code', async () => {
    const { status, stderr } = await runFixture('unhandledRejection');
    expect(status).toBe(1);
    expect(stderr).toMatch(/\[fatal\] unhandled promise rejection/);
    expect(stderr).toMatch(/deliberate unhandled rejection/);
  }, 20000);
});

afterAll(async () => {
  await pool.end();
});
