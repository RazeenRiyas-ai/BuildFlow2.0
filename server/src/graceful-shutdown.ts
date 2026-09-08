import { logger } from './utils/logger';
import { markShuttingDown } from './health/readiness-state';

/**
 * Graceful shutdown for the real running server process (see server.ts). Deliberately NOT wired
 * into app.ts or any test's own ad-hoc http.Server — this attaches real SIGTERM/SIGINT handlers to
 * the current process, and must only ever be installed once, by the actual entry point.
 *
 * Structural (not concrete pg.Pool/http.Server/socket.io Server) types are used for the
 * dependencies so a test can substitute a minimal fake for any one of them — e.g. to exercise the
 * bounded timeout by passing a "pool" whose end() never resolves — without needing to monkey-patch
 * real modules.
 *
 * Logging here goes through the shared structured logger (utils/logger.ts), which is a plain
 * synchronous console.log/console.error call under the hood — never buffered, queued, or waiting
 * on any I/O of its own — so it cannot itself delay or hang the shutdown sequence below it, and
 * there's no risk of a partially-written async log write racing the process.exit() calls here.
 */

export interface ClosableServer {
  close(callback: (err?: Error) => void): void;
}

/** http.Server's own `.listening` flag — used to detect that the server was already closed (see
 * the comment on closeHttpServerResource below) without triggering a second, spurious close(). */
export interface ClosableHttpServer extends ClosableServer {
  listening: boolean;
}

export interface ClosablePool {
  end(): Promise<void>;
}

export interface GracefulShutdownDeps {
  httpServer: ClosableHttpServer;
  io: ClosableServer;
  pool: ClosablePool;
  /** Overridable so tests can exercise the bounded-timeout path without waiting the full
   * production duration. Defaults to 10 seconds. */
  timeoutMs?: number;
  /** Overridable so a test can observe what code shutdown would exit with instead of actually
   * exiting the process running the test. Real usage always uses the real process.exit. */
  exit?: (code: number) => void;
  /** Test-only: delays the start of the actual close sequence by this many ms, strictly AFTER
   * readiness has already been marked not-ready (see markShuttingDown below) and the "starting
   * graceful shutdown" log line has been emitted. Lets a test observe the real, brief window where
   * the process has begun shutting down but its HTTP server is still genuinely open — proving
   * GET /health/ready flips to 503 immediately, before anything is actually torn down, rather than
   * only after. Defaults to 0 (no delay), so production shutdown timing is completely unaffected. */
  preCloseDelayMs?: number;
}

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Installs SIGTERM/SIGINT handlers that run the shutdown sequence exactly once, in this fixed
 * order: stop accepting new Socket.io connections and close existing ones, then close the HTTP
 * server (which lets already-in-flight requests finish naturally — Node's http.Server.close()
 * only refuses new connections, its callback fires once every existing one has ended on its own),
 * then close the Postgres pool. The pool is closed LAST deliberately: an in-flight HTTP request
 * still draining may need it to finish producing its response.
 *
 * A single bounded timer covers the whole sequence (not one timer per step) — if shutdown hasn't
 * finished by then, the process is forced to exit rather than hang indefinitely. A failure in any
 * one step is logged and the remaining steps are still attempted.
 */
export function installGracefulShutdown(deps: GracefulShutdownDeps): void {
  const {
    httpServer,
    io,
    pool,
    timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
    exit = process.exit.bind(process),
    preCloseDelayMs = 0,
  } = deps;
  let shuttingDown = false;

  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) {
      logger.info(`[shutdown] ${signal} received — shutdown already in progress, ignoring`);
      return;
    }
    shuttingDown = true;
    // Marked before anything else runs, and before any await — so GET /health/ready (Phase 2.6.6)
    // reflects "not ready" from the very first instant of shutdown, even while the HTTP server
    // below is still momentarily open and draining in-flight requests.
    markShuttingDown();
    logger.info(`[shutdown] ${signal} received — starting graceful shutdown`);

    if (preCloseDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, preCloseDelayMs));
    }

    let timedOut = false;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      logger.error('[shutdown] shutdown timeout exceeded — forcing exit');
      exit(1);
    }, timeoutMs);

    await closeServerResource(io, 'Socket.io');
    await closeHttpServerResource(httpServer);
    await closePoolResource(pool);

    clearTimeout(timeoutTimer);
    if (!timedOut) {
      logger.info('[shutdown] shutdown completed');
      exit(0);
    }
  }

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

function closeServerResource(resource: ClosableServer, name: string): Promise<void> {
  return new Promise((resolve) => {
    resource.close((err) => {
      if (err) {
        logger.error(`[shutdown] error closing ${name} (continuing)`, err);
      } else {
        logger.info(`[shutdown] ${name} closed`);
      }
      resolve();
    });
  });
}

/**
 * Socket.io's own close() (see closeServerResource above, called on `io` just before this) closes
 * the http.Server it was constructed with as an inherent part of its own behavior, whenever it was
 * given one — confirmed directly in the installed socket.io package's source, not assumed. Calling
 * httpServer.close() again afterward would find it already stopped and produce a spurious
 * "server is not running" error. Checking `.listening` first makes this correct either way: if
 * Socket.io already closed it, this just confirms and logs that; if for any reason it didn't (a
 * future socket.io version, or this server ever being reused without Socket.io), the explicit
 * close() below still runs and is still awaited.
 */
function closeHttpServerResource(httpServer: ClosableHttpServer): Promise<void> {
  if (!httpServer.listening) {
    logger.info('[shutdown] HTTP server closed');
    return Promise.resolve();
  }
  return closeServerResource(httpServer, 'HTTP server');
}

async function closePoolResource(pool: ClosablePool): Promise<void> {
  try {
    await pool.end();
    logger.info('[shutdown] database pool closed');
  } catch (err) {
    logger.error('[shutdown] error closing database pool (continuing)', err);
  }
}
