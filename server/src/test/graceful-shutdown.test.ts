import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';

const fixturePath = path.join(__dirname, 'fixtures', 'graceful-shutdown-fixture.ts');

interface FixtureResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

interface FixtureHandle {
  send(signal: NodeJS.Signals): void;
  /** Resolves once `pattern` has appeared in the child's stdout so far (or already has). Lets a
   * test wait for a specific point in the shutdown sequence instead of guessing at a delay. */
  waitForOutput(pattern: RegExp): Promise<void>;
  waitForExit(): Promise<FixtureResult>;
  /** The fixture's real HTTP port — lets a test make real requests (e.g. to /health/ready)
   * against the actual Express app running inside the fixture process. */
  port: number;
}

/**
 * Spawns the real fixture server as a real child process (async spawn — never a sync API that
 * would stall the test runner's event loop) and resolves once it prints its READY line.
 *
 * Runs via `node --import tsx` (a loader hook inside a single real node process) rather than the
 * `tsx` CLI binary. The tsx CLI wraps the script in its own child process and relays OS signals to
 * it through an internal async ack/timeout protocol — confirmed by reading node_modules/tsx's own
 * source — which races and can silently drop or misdeliver a signal when two different signals
 * (e.g. SIGTERM immediately followed by SIGINT) arrive in the same tick. That relay layer doesn't
 * exist in production (server.ts runs directly under node, no tsx wrapper in between), so it would
 * only be a test-harness artifact, not a real bug — `--import tsx` delivers the OS signal straight
 * to the process actually running installGracefulShutdown, matching production.
 */
function startFixture(env: Record<string, string> = {}): Promise<FixtureHandle> {
  return new Promise((resolveReady, rejectReady) => {
    const child = spawn(process.execPath, ['--import', 'tsx', fixturePath], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let ready = false;
    const outputWaiters: Array<{ pattern: RegExp; resolve: () => void }> = [];

    const exitPromise = new Promise<FixtureResult>((resolveExit) => {
      child.on('exit', (code, signal) => {
        resolveExit({ exitCode: code, signal, stdout, stderr });
      });
    });

    const checkOutputWaiters = () => {
      for (let i = outputWaiters.length - 1; i >= 0; i -= 1) {
        if (outputWaiters[i].pattern.test(stdout)) {
          outputWaiters[i].resolve();
          outputWaiters.splice(i, 1);
        }
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      const readyMatch = !ready && stdout.match(/READY (\d+)/);
      if (readyMatch) {
        ready = true;
        resolveReady({
          send: (signal) => {
            child.kill(signal);
          },
          waitForOutput: (pattern) =>
            new Promise((resolve) => {
              if (pattern.test(stdout)) {
                resolve();
              } else {
                outputWaiters.push({ pattern, resolve });
              }
            }),
          waitForExit: () => exitPromise,
          port: Number(readyMatch[1]),
        });
      }
      checkOutputWaiters();
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', rejectReady);

    setTimeout(() => {
      if (!ready) {
        rejectReady(new Error(`fixture did not become ready in time.\nstdout: ${stdout}\nstderr: ${stderr}`));
      }
    }, 10000);
  });
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('graceful shutdown (real subprocess)', () => {
  it('SIGTERM triggers an orderly shutdown, closing every resource, and exits 0', async () => {
    const fixture = await startFixture();
    fixture.send('SIGTERM');
    const result = await fixture.waitForExit();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/\[shutdown\] SIGTERM received — starting graceful shutdown/);
    expect(result.stdout).toMatch(/\[shutdown\] Socket\.io closed/);
    expect(result.stdout).toMatch(/\[shutdown\] HTTP server closed/);
    expect(result.stdout).toMatch(/\[shutdown\] database pool closed/);
    expect(result.stdout).toMatch(/\[shutdown\] shutdown completed/);
  }, 20000);

  it('SIGINT triggers an orderly shutdown and exits 0', async () => {
    const fixture = await startFixture();
    fixture.send('SIGINT');
    const result = await fixture.waitForExit();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/\[shutdown\] SIGINT received — starting graceful shutdown/);
    expect(result.stdout).toMatch(/\[shutdown\] shutdown completed/);
  }, 20000);

  it('is idempotent: SIGTERM immediately followed by SIGINT only runs cleanup once', async () => {
    // SIMULATE_SLOW_CLOSE holds the (otherwise sub-millisecond) shutdown sequence open for a bit —
    // see the fixture — purely so the window in which "shutdown is genuinely still in-flight" is wide
    // enough to reliably land the second signal in. Without it, closing three in-memory/local
    // resources for real can complete, and the process can exit, faster than the OS schedules
    // delivery of a second, distinct signal into the child's event loop or the parent even observes
    // any stdout from the child, making the scenario impossible to test deterministically. This does
    // not change installGracefulShutdown's own logic or its production behavior at all.
    const fixture = await startFixture({ SIMULATE_SLOW_CLOSE: '1' });
    // Two DIFFERENT signal types, rather than the same signal twice — standard POSIX signals of the
    // same type are not queued and can coalesce at the OS level before Node ever sees a second one,
    // which would make that variant an unreliable test of our own idempotency guard rather than of
    // OS signal semantics. SIGTERM immediately followed by SIGINT is also exactly the scenario named
    // in the requirements ("if SIGTERM and SIGINT arrive close together").
    fixture.send('SIGTERM');
    await fixture.waitForOutput(/\[shutdown\] SIGTERM received — starting graceful shutdown/);
    fixture.send('SIGINT');
    const result = await fixture.waitForExit();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/shutdown already in progress, ignoring/);
    expect(countOccurrences(result.stdout, '[shutdown] Socket.io closed')).toBe(1);
    expect(countOccurrences(result.stdout, '[shutdown] HTTP server closed')).toBe(1);
    expect(countOccurrences(result.stdout, '[shutdown] database pool closed')).toBe(1);
    expect(countOccurrences(result.stdout, '[shutdown] shutdown completed')).toBe(1);
  }, 20000);

  it('forces exit via the bounded timeout if a resource never finishes closing', async () => {
    const fixture = await startFixture({ SIMULATE_HANG: 'pool', SHUTDOWN_TIMEOUT_MS: '500' });
    const startedAt = Date.now();
    fixture.send('SIGTERM');
    const result = await fixture.waitForExit();
    const elapsedMs = Date.now() - startedAt;

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/\[shutdown\] Socket\.io closed/);
    expect(result.stdout).toMatch(/\[shutdown\] HTTP server closed/);
    expect(result.stdout).not.toMatch(/database pool closed/);
    expect(result.stderr).toMatch(/\[shutdown\] shutdown timeout exceeded — forcing exit/);
    // Proves the process didn't hang indefinitely — it was forced within a bounded window, not
    // left waiting on the pool.end() call that will never resolve.
    expect(elapsedMs).toBeLessThan(5000);
  }, 20000);

  it('GET /health/ready flips to 503 the instant shutdown begins, while GET /health/live stays 200 (Phase 2.6.6)', async () => {
    // SIMULATE_PRE_CLOSE_DELAY_MS holds the real HTTP server genuinely open for a bit right after
    // shutdown begins — see graceful-shutdown.ts's preCloseDelayMs and the fixture. Without it,
    // closing these in-memory/local resources for real can complete (and stop accepting new
    // connections) faster than this test's own HTTP requests could land, making the "still open,
    // but already reporting not-ready" window impossible to observe deterministically. Defaults to
    // 0 in production, so this changes nothing about real shutdown timing.
    const fixture = await startFixture({ SIMULATE_PRE_CLOSE_DELAY_MS: '300' });
    const baseUrl = `http://127.0.0.1:${fixture.port}`;

    const beforeReady = await fetch(`${baseUrl}/health/ready`);
    expect(beforeReady.status).toBe(200);
    expect(await beforeReady.json()).toEqual({ status: 'ok' });

    const beforeLive = await fetch(`${baseUrl}/health/live`);
    expect(beforeLive.status).toBe(200);

    fixture.send('SIGTERM');
    await fixture.waitForOutput(/\[shutdown\] SIGTERM received — starting graceful shutdown/);

    const duringReady = await fetch(`${baseUrl}/health/ready`);
    expect(duringReady.status).toBe(503);
    expect(await duringReady.json()).toEqual({ status: 'unavailable' });

    const duringLive = await fetch(`${baseUrl}/health/live`);
    expect(duringLive.status).toBe(200);

    const result = await fixture.waitForExit();
    expect(result.exitCode).toBe(0);
  }, 20000);
});
