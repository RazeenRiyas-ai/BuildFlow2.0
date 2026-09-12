import * as Sentry from '@sentry/node';
import { env } from '../config/env';
import { logger, redact } from '../utils/logger';

/**
 * Minimal, deliberately-manual error tracking (Phase 3.9) — not the general-purpose "instrument
 * everything" setup Sentry's docs default to. Two design decisions drive everything below:
 *
 * 1. Absent SENTRY_DSN must never affect the running application in any way. `init()` no-ops
 *    (Sentry.init is never called) when the DSN isn't set, and every exported function here is
 *    wrapped in try/catch so a Sentry SDK bug, a network failure, or a bad DSN can never throw out
 *    into a caller — including process-safety.ts's fatal-error handlers, which are themselves the
 *    last line of defense and must not gain a new way to be crashed.
 *
 * 2. `defaultIntegrations: false` (NOT `integrations: []` alone — that option is additive on top
 *    of the default set, not a replacement for it; passing only an empty array here would silently
 *    leave every default integration active) disables every one of Sentry's automatic integrations
 *    — HTTP instrumentation/breadcrumbs, Express request-data capture, its own
 *    uncaughtException/unhandledRejection auto-capture, and critically ContextLinesIntegration,
 *    which reads and attaches the actual surrounding SOURCE CODE lines around every stack frame.
 *    An earlier version of this module set only `integrations: []` and a controlled test (see
 *    sentry-observability.test.ts) caught it immediately: a plaintext secret passed as a literal
 *    in a test call was captured in full via that integration's source-context lines, completely
 *    bypassing the key-based beforeSend redaction below (redaction operates on event fields like
 *    tags/extra, not on embedded source code strings). This app already has its own
 *    uncaughtException/unhandledRejection handlers (process-safety.ts) and its own global error
 *    handler (middleware/errorHandler.ts); every event sent to Sentry is the result of an explicit
 *    captureError() call below, with hand-built, minimal context — never anything Sentry captured
 *    on its own initiative.
 *
 * On top of that, `beforeSend` applies the exact same key-based redaction the structured logger
 * uses (utils/logger.ts's `redact`) to every event's extra/tags/contexts before it ever leaves the
 * process, and strips the request/user fields entirely as a second, structural layer (should any
 * future integration or SDK default ever populate them). This mirrors the logger's own documented
 * limitation: redaction is key-name-based, not a scan of free-text error messages — a call site
 * that interpolates a raw secret into an Error's message string is not caught by this, exactly as
 * already documented in logger.ts. Call sites must not do that, here or in logs.
 */

let initialized = false;

/**
 * `overrides` exists solely so tests can inject a fake DSN and a custom in-memory `transport`
 * (Sentry's own supported extension point — see @sentry/core's Transport interface) to verify the
 * real init → captureException → beforeSend → transport pipeline end-to-end without making a
 * network call. Production code (server.ts) always calls this with no arguments; `overrides`
 * layers on top of the real config below, it never replaces the redaction/integrations settings
 * that matter for production safety.
 */
export function initSentry(overrides?: Partial<Sentry.NodeOptions>): void {
  const dsn = overrides?.dsn ?? env.SENTRY_DSN;
  if (!dsn) {
    logger.info('[sentry] SENTRY_DSN not set — error tracking disabled');
    return;
  }

  try {
    Sentry.init({
      dsn,
      environment: env.SENTRY_ENVIRONMENT,
      // Minimal error tracking only — no performance tracing/profiling, which would otherwise
      // sample and transmit additional request-shaped data this phase deliberately avoids.
      tracesSampleRate: 0,
      // Never attach IP address, cookies, or other default-PII fields Sentry would otherwise infer
      // from ambient request context.
      sendDefaultPii: false,
      // See module doc comment above: no automatic instrumentation of any kind — this, not
      // `integrations: []` alone, is what actually disables the default integration set.
      defaultIntegrations: false,
      integrations: [],
      beforeSend(event) {
        return scrubEvent(event);
      },
      ...overrides,
    });
    initialized = true;
    logger.info('[sentry] error tracking initialized', { environment: env.SENTRY_ENVIRONMENT });
  } catch (err) {
    // A Sentry init failure must never prevent the server from starting — log and continue with
    // error tracking simply disabled for this process lifetime.
    initialized = false;
    logger.error('[sentry] initialization failed — continuing with error tracking disabled', err);
  }
}

/** Test-only escape hatch: resets the module-local `initialized` flag so a test file can exercise
 * both the "DSN absent" and "DSN present" paths across multiple test cases in one process. Never
 * imported by production code. */
export function resetSentryForTests(): void {
  initialized = false;
}

/** True only after a successful initSentry() call with a DSN present — lets tests/tools assert
 * on this without relying on Sentry's own (private) internal state. */
export function isSentryInitialized(): boolean {
  return initialized;
}

/**
 * Structurally removes anything request/user-shaped, then key-redacts whatever remains in
 * extra/tags/contexts. Applied as `beforeSend`, so this runs for every event regardless of which
 * captureError() call site produced it — a single, auditable choke point rather than trusting each
 * call site to have redacted its own context correctly.
 */
/** Exported for direct unit testing of the scrubbing logic itself (see
 * sentry-observability.test.ts) — the real Sentry SDK, with integrations disabled, never actually
 * populates request/user/breadcrumbs in the first place, so a hand-built event is the only way to
 * directly exercise this defense-in-depth path deterministically. */
export function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  delete event.request;
  delete event.user;
  delete event.breadcrumbs;

  if (event.extra) {
    event.extra = redact(event.extra, 0) as typeof event.extra;
  }
  if (event.tags) {
    event.tags = redact(event.tags, 0) as typeof event.tags;
  }
  if (event.contexts) {
    event.contexts = redact(event.contexts, 0) as typeof event.contexts;
  }

  return event;
}

export interface CaptureContext {
  /** Free-form, already-safe key/value pairs (e.g. requestId, route, method) — never put a raw
   * request/order/user object here; scrubEvent above redacts by key name but the fewer sensitive
   * shapes that reach Sentry in the first place, the better. */
  tags?: Record<string, string>;
}

/**
 * The only way any other module in this codebase should send an error to Sentry. Never throws —
 * see module doc comment. No-ops silently (does not even log) when Sentry was never initialized,
 * matching this module's "absent DSN changes nothing" guarantee without adding log noise to every
 * error path on a server that simply hasn't configured error tracking.
 */
export function captureError(err: unknown, context?: CaptureContext): void {
  if (!initialized) return;
  try {
    Sentry.captureException(err, context ? { tags: context.tags } : undefined);
  } catch (captureErr) {
    logger.error('[sentry] captureException failed', captureErr);
  }
}

/**
 * Bounded flush so a process that's about to exit(1) (process-safety.ts) gives Sentry a last,
 * time-limited chance to actually deliver the event it was just handed — captureException itself
 * only enqueues the event; without this, process.exit() immediately after could kill the process
 * before the outgoing HTTP request ever leaves. Never throws and never hangs: resolves within
 * timeoutMs regardless of outcome (Sentry.flush's own contract), and any unexpected error is
 * swallowed so a flush failure can never delay or block the exit it precedes.
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!initialized) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch (err) {
    logger.error('[sentry] flush failed', err);
  }
}
