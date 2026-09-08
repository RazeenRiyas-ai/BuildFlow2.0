import type { DefaultEventsMap, Server as SocketIOServer } from 'socket.io';
import type { SocketData } from './socket-types';

export type RealtimeServer = SocketIOServer<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

let io: RealtimeServer | null = null;

/** Set once by initRealtime(). Kept in its own file (no imports from modules/orders, modules/hq,
 * or socket-server.ts) so that order-events.ts — which the order/hq services import to emit
 * events — can never end up in an import cycle back to those same services. */
export function setRealtimeServer(server: RealtimeServer) {
  io = server;
}

export function getRealtimeServer(): RealtimeServer {
  if (!io) {
    throw new Error('Realtime server has not been initialized yet — call initRealtime() first');
  }
  return io;
}
