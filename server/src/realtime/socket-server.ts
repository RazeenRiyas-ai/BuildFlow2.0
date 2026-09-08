import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { env } from '../config/env';
import { socketAuthMiddleware } from './socket-auth';
import { setRealtimeServer } from './realtime-registry';
import { registerOrderRoomHandlers } from './order-room-handlers';
import { logger } from '../utils/logger';

export type { RealtimeServer } from './realtime-registry';
export { getRealtimeServer } from './realtime-registry';

/**
 * Attaches Socket.io to the existing Node HTTP server (the same one Express is already using —
 * this does not replace or duplicate Express). Every connection must authenticate with the
 * existing JWT access token before it is accepted; see socket-auth.ts.
 *
 * The io singleton itself lives in realtime-registry.ts (a dependency-free leaf module) so that
 * order-events.ts — imported by the order/hq services to emit events — never has an import path
 * back to this file, order-room-handlers.ts, or order-room-auth.ts, which in turn import from
 * those same services. See realtime-registry.ts for the full explanation.
 */
export function initRealtime(httpServer: HttpServer) {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',') },
  });

  setRealtimeServer(io);
  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    const { sub: userId, role } = socket.data.user;
    logger.info('[realtime] connected', { socketId: socket.id, userId, role });

    registerOrderRoomHandlers(socket);

    socket.on('disconnect', (reason) => {
      logger.info('[realtime] disconnected', { socketId: socket.id, reason });
    });
  });

  return io;
}
