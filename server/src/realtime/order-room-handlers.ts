import crypto from 'node:crypto';
import { z } from 'zod';
import type { DefaultEventsMap, Socket } from 'socket.io';
import type { SocketData } from './socket-types';
import { canJoinOrderRoom } from './order-room-auth';
import { orderRoomName } from './order-rooms';
import { runWithRequestId } from '../utils/request-context';

type OrderRoomSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

type Ack = (response: { ok: boolean; error?: string }) => void;

const joinPayloadSchema = z.object({ orderId: z.string().uuid() });

/**
 * Wires order:join / order:leave for one already-authenticated socket. This only manages
 * Socket.io room membership — the only order data it ever reads is the read-only ownership
 * check in canJoinOrderRoom; no order mutation happens here or anywhere else in the realtime
 * layer.
 */
/**
 * Each inbound event gets its own fresh correlation ID via runWithRequestId — not the HTTP
 * request-ID mechanism reused as-is, since a Socket.io event isn't an HTTP request and has no
 * X-Request-ID header to read (only the initial handshake has headers; individual emitted events
 * don't). This is a deliberately small, additive step: it makes getRequestId() usable from
 * anywhere canJoinOrderRoom or future code in this path might call it, without touching Socket.io
 * auth, connection handling, or order-room architecture at all. Broader realtime tracing (e.g.
 * correlating a socket event back to whatever HTTP request originally triggered a broadcast) is
 * out of scope for this milestone — see order-events.ts, whose emit() calls already run inside the
 * originating HTTP request's own request-ID context (see AGENTS/Phase 2.6.3 report).
 */
export function registerOrderRoomHandlers(socket: OrderRoomSocket) {
  socket.on('order:join', async (rawPayload: unknown, ack?: Ack) => {
    await runWithRequestId(crypto.randomUUID(), async () => {
      const parsed = joinPayloadSchema.safeParse(rawPayload);
      if (!parsed.success) {
        ack?.({ ok: false, error: 'Invalid orderId' });
        return;
      }

      const allowed = await canJoinOrderRoom(socket.data.user, parsed.data.orderId);
      if (!allowed) {
        // Deliberately one generic message for every denial reason — see order-room-auth.ts.
        ack?.({ ok: false, error: 'Not authorized to join this order' });
        return;
      }

      await socket.join(orderRoomName(parsed.data.orderId));
      ack?.({ ok: true });
    });
  });

  socket.on('order:leave', async (rawPayload: unknown, ack?: Ack) => {
    await runWithRequestId(crypto.randomUUID(), async () => {
      const parsed = joinPayloadSchema.safeParse(rawPayload);
      if (!parsed.success) {
        ack?.({ ok: false, error: 'Invalid orderId' });
        return;
      }

      await socket.leave(orderRoomName(parsed.data.orderId));
      ack?.({ ok: true });
    });
  });
}
