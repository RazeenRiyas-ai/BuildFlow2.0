import { logger } from './utils/logger';

/**
 * Last-resort handlers for genuinely unknown failures — a promise rejection or thrown error that
 * escaped every other layer (asyncHandler, the realtime emitter's own try/catch, etc.). Deliberately
 * NOT imported by app.ts or any test file: these handlers call process.exit(), and attaching them
 * anywhere a test suite could trigger one would kill the entire test run instead of failing one
 * test. This must only ever be active in the real running server process (see server.ts).
 *
 * This is a safety net, not a recovery strategy. Once something reaches uncaughtException or
 * unhandledRejection, the process's internal state is no longer trustworthy — logging the failure
 * and continuing to serve requests risks silently corrupting data or returning wrong responses
 * from an unknown state. Logging with context and then exiting lets the process manager (systemd,
 * Docker, PM2, a PaaS) restart into a known-good state instead.
 *
 * logger.error is used instead of raw console.error purely for structured (name/message/stack)
 * serialization of the failure — it is still a plain synchronous console.error call under the
 * hood (see utils/logger.ts), so this keeps the exact same guarantee the old code had: the log is
 * fully written before process.exit(1) runs on the next line, with no async logging step that
 * could be cut off mid-write.
 */
export function installProcessSafetyHandlers(): void {
  process.on('unhandledRejection', (reason) => {
    logger.error('[fatal] unhandled promise rejection — terminating for a clean restart', reason);
    process.exit(1);
  });

  process.on('uncaughtException', (err) => {
    logger.error('[fatal] uncaught exception — terminating for a clean restart', err);
    process.exit(1);
  });
}
