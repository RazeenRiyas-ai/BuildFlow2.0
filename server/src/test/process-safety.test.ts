import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
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

/**
 * Integration-level (real subprocess), not another unit test of observability/sentry.ts's own
 * functions — sentry-observability.test.ts and sentry-safety.test.ts already cover that module in
 * isolation. This proves the actual WIRING in process-safety.ts: that a real uncaught
 * exception/unhandled rejection, in a real separate process, with Sentry genuinely initialized,
 * really does reach Sentry.captureException with the right content, and really is flushed before
 * the process exits — the exact integration point a pure unit test of sentry.ts cannot exercise,
 * because sentry.ts's own tests never call installProcessSafetyHandlers() or trigger a real crash.
 */
describe('process-level crash prevention actually reports to Sentry (real subprocess, real wiring)', () => {
  const sentryFixturePath = path.join(__dirname, 'fixtures', 'process-safety-sentry-fixture.ts');
  const tsxBin = path.join(__dirname, '..', '..', 'node_modules', '.bin', 'tsx');

  function runSentryFixture(outputFile: string, mode: string): Promise<{ status: number; stderr: string }> {
    return new Promise((resolve) => {
      execFile(tsxBin, [sentryFixturePath, outputFile, mode], { timeout: 15000 }, (error, _stdout, stderr) => {
        if (!error) {
          resolve({ status: 0, stderr });
          return;
        }
        const exitCode = typeof error.code === 'number' ? error.code : 1;
        resolve({ status: exitCode, stderr });
      });
    });
  }

  function tempOutputFile(): string {
    return path.join(os.tmpdir(), `process-safety-sentry-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  }

  it('an uncaught exception is really captured by Sentry (real envelope, correct content) before the process exits', async () => {
    const outputFile = tempOutputFile();
    try {
      const { status } = await runSentryFixture(outputFile, 'uncaughtException');
      expect(status).toBe(1);

      // If this file was never written, the real process-safety.ts -> observability/sentry.ts
      // wiring did not fire — this is the assertion a pure unit test of sentry.ts cannot make.
      const raw = fs.readFileSync(outputFile, 'utf-8');
      const envelopes = JSON.parse(raw);
      expect(envelopes.length).toBeGreaterThanOrEqual(1);
      const serialized = JSON.stringify(envelopes[0]);
      expect(serialized).toContain('deliberate uncaught exception for real Sentry wiring test');
      expect(serialized).toContain('"fatal":"true"');
      expect(serialized).toContain('"kind":"uncaughtException"');
    } finally {
      fs.rmSync(outputFile, { force: true });
    }
  }, 20000);

  it('an unhandled rejection is really captured by Sentry (real envelope, correct content) before the process exits', async () => {
    const outputFile = tempOutputFile();
    try {
      const { status } = await runSentryFixture(outputFile, 'unhandledRejection');
      expect(status).toBe(1);

      const raw = fs.readFileSync(outputFile, 'utf-8');
      const envelopes = JSON.parse(raw);
      expect(envelopes.length).toBeGreaterThanOrEqual(1);
      const serialized = JSON.stringify(envelopes[0]);
      expect(serialized).toContain('deliberate unhandled rejection for real Sentry wiring test');
      expect(serialized).toContain('"fatal":"true"');
      expect(serialized).toContain('"kind":"unhandledRejection"');
    } finally {
      fs.rmSync(outputFile, { force: true });
    }
  }, 20000);
});

afterAll(async () => {
  await pool.end();
});
