import http from 'http';
import { app } from './app';
import { env } from './config/env';
import { pool } from './config/db';
import { initRealtime } from './realtime/socket-server';
import { installProcessSafetyHandlers } from './process-safety';
import { installGracefulShutdown } from './graceful-shutdown';
import { logger } from './utils/logger';

installProcessSafetyHandlers();

const httpServer = http.createServer(app);
const io = initRealtime(httpServer);

installGracefulShutdown({ httpServer, io, pool });

httpServer.listen(env.PORT, () => {
  logger.info(`BuildFlow server listening on port ${env.PORT}`);
});
