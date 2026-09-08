/**
 * Tracks one process-lifetime fact: has graceful shutdown begun? This is genuinely process-global
 * state (there is exactly one server process, exactly one shutdown), not per-request state — the
 * same category as the `shuttingDown` closure flag already inside graceful-shutdown.ts, just made
 * observable from outside that module so the readiness route (health/health.routes.ts) can check
 * it without graceful-shutdown.ts depending on Express or the route depending on the shutdown
 * installer.
 *
 * Deliberately NOT a cache of "is the app ready" as a whole — readiness also depends on live
 * database connectivity (db-check.ts), which can change from one instant to the next and must
 * always be checked fresh (see health.routes.ts). This module only ever moves one way, once, per
 * process: not-shutting-down -> shutting-down.
 */
let shuttingDown = false;

export function markShuttingDown(): void {
  shuttingDown = true;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

/** Test-only: this module's state is a real process-lifetime singleton in production (it only
 * ever moves forward, once, per real process), but a single test file's module registry is
 * shared across all of its own tests — this lets a test undo a simulated markShuttingDown() so it
 * doesn't leak into later tests in the same file. Never called from production code. */
export function resetForTests(): void {
  shuttingDown = false;
}
