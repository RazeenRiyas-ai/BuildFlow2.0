import { useEffect, useRef } from 'react';

import { getRealtimeSocket } from '@/services/realtime-client';

const ORDER_EVENTS = [
  'order.status_changed',
  'order.supplier_contacted',
  'order.supplier_assigned',
  'order.driver_assigned',
  'order.delivery_updated',
] as const;

/**
 * Subscribes to live updates for one order while this screen is mounted, and calls `onUpdate`
 * (typically the screen's own `refetch`) whenever any of the 5 order events arrive. Payloads are
 * deliberately never used directly — refetching through the existing, already-trusted REST path
 * keeps this the single source of truth instead of hand-patching state from two places.
 *
 * Never required for correctness: if the socket isn't connected (offline, realtime down, still
 * connecting), the screen simply keeps working off its normal focus-based refresh.
 */
export function useOrderRoom(orderId: string | undefined, onUpdate: () => void) {
  const onUpdateRef = useRef(onUpdate);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  });

  useEffect(() => {
    const socket = getRealtimeSocket();
    if (!orderId || !socket) return;

    function join() {
      socket!.emit('order:join', { orderId });
    }
    function handleEvent() {
      onUpdateRef.current();
    }

    if (socket.connected) join();
    socket.on('connect', join);
    for (const event of ORDER_EVENTS) socket.on(event, handleEvent);

    return () => {
      socket.off('connect', join);
      for (const event of ORDER_EVENTS) socket.off(event, handleEvent);
      if (socket.connected) socket.emit('order:leave', { orderId });
    };
  }, [orderId]);
}
