/* eslint-disable */
// Standalone script spawned as a real child process by graceful-shutdown.test.ts — never imported
// by the app or by vitest directly. Builds a real HTTP server wrapping the REAL Express app (so
// GET /health/ready here is the actual production route, not a hand-rolled stand-in), a real
// Socket.io server, and uses the real Postgres pool (config/db.ts, pointed at .env.test via the
// same mechanism every other backend test already uses), then installs the real graceful-shutdown
// handler, so the test can send real OS signals and observe real close *and* real readiness
// behavior end to end.
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { app } from '../../app';
import { pool } from '../../config/db';
import { installGracefulShutdown } from '../../graceful-shutdown';

const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer);

const timeoutMs = process.env.SHUTDOWN_TIMEOUT_MS ? Number(process.env.SHUTDOWN_TIMEOUT_MS) : undefined;
const preCloseDelayMs = process.env.SIMULATE_PRE_CLOSE_DELAY_MS ? Number(process.env.SIMULATE_PRE_CLOSE_DELAY_MS) : undefined;

// Test-only hook: simulates one resource never finishing its close(), to exercise the bounded
// timeout without needing to actually break Postgres or the HTTP server for real.
if (process.env.SIMULATE_HANG === 'pool') {
  (pool as unknown as { end: () => Promise<void> }).end = () => new Promise<void>(() => {});
}

// Test-only hook: holds the shutdown sequence open for a bit before letting the pool actually
// close, so a test can reliably send a second signal while shutdown is genuinely still in-flight.
// Closing these in-memory/local resources for real is normally so fast (sub-millisecond to a couple
// of ms) that there's no reliable wall-clock window to hit otherwise — this doesn't change
// production behavior at all, it only exists to make that one test deterministic.
if (process.env.SIMULATE_SLOW_CLOSE === '1') {
  const realEnd = pool.end.bind(pool);
  (pool as unknown as { end: () => Promise<void> }).end = () =>
    new Promise((resolve) => setTimeout(() => resolve(realEnd()), 300));
}

installGracefulShutdown({ httpServer, io, pool, timeoutMs, preCloseDelayMs });

httpServer.listen(0, () => {
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  // The parent test process waits for this exact line before sending any signal.
  console.log(`READY ${port}`);
});
