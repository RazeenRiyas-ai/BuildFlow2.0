import http from 'http';
import { app } from './app';
import { env } from './config/env';
import { pool } from './config/db';
import { initRealtime } from './realtime/socket-server';
import { installProcessSafetyHandlers } from './process-safety';
import { installGracefulShutdown } from './graceful-shutdown';
import { startStaleOrderReminderJob } from './jobs/stale-order-reminder-job';
import { logger } from './utils/logger';

installProcessSafetyHandlers();

const httpServer = http.createServer(app);
const io = initRealtime(httpServer);

installGracefulShutdown({ httpServer, io, pool });

// Independent of installGracefulShutdown's own SIGTERM/SIGINT handlers above — Node allows more
// than one listener per signal, so this stops the reminder job's timer without needing to modify
// that already-tested shutdown sequence at all.
const stopStaleOrderReminderJob = startStaleOrderReminderJob();
process.on('SIGTERM', stopStaleOrderReminderJob);
process.on('SIGINT', stopStaleOrderReminderJob);

httpServer.listen(env.PORT, () => {
  logger.info(`BuildFlow server listening on port ${env.PORT}`);
});
