import type { OrderStatus } from '../modules/orders/orders.service';
import { orderRoomName } from './order-rooms';
import { getRealtimeServer } from './realtime-registry';
import { logger } from '../utils/logger';

export const ORDER_EVENTS = {
  STATUS_CHANGED: 'order.status_changed',
  SUPPLIER_CONTACTED: 'order.supplier_contacted',
  SUPPLIER_ASSIGNED: 'order.supplier_assigned',
  DRIVER_ASSIGNED: 'order.driver_assigned',
  DELIVERY_UPDATED: 'order.delivery_updated',
} as const;

interface OrderEventBase {
  orderId: string;
  /** ISO-8601 timestamp of when the emitting server processed the mutation. */
  occurredAt: string;
}

export interface OrderStatusChangedPayload extends OrderEventBase {
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
}

export interface OrderSupplierContactedPayload extends OrderEventBase {
  supplierId: string;
  outcome: string;
}

export interface OrderSupplierAssignedPayload extends OrderEventBase {
  supplierId: string;
}

/** Deliberately just the base shape: driver name/phone are already available to any client with
 * REST access to this order, and duplicating them into a broadcast channel is unnecessary. */
export type OrderDriverAssignedPayload = OrderEventBase;

/** Deliberately just the base shape: the delivery note is free text an operator typed and is
 * fetched via the existing, already-authorized REST endpoint rather than broadcast here. */
export type OrderDeliveryUpdatedPayload = OrderEventBase;

/**
 * Emits to everyone currently subscribed to this order's room. Never throws: realtime delivery
 * is best-effort and must never affect the REST response or DB mutation that already succeeded
 * before this is called (including when the realtime server hasn't been initialized at all,
 * which is expected in most existing tests that only exercise the REST layer).
 */
function emit(orderId: string, event: string, payload: unknown) {
  try {
    getRealtimeServer().to(orderRoomName(orderId)).emit(event, payload);
  } catch (err) {
    logger.error(`[realtime] failed to emit ${event}`, err, { orderId });
  }
}

export function emitOrderStatusChanged(orderId: string, fromStatus: OrderStatus, toStatus: OrderStatus) {
  const payload: OrderStatusChangedPayload = { orderId, fromStatus, toStatus, occurredAt: new Date().toISOString() };
  emit(orderId, ORDER_EVENTS.STATUS_CHANGED, payload);
}

export function emitSupplierContacted(orderId: string, supplierId: string, outcome: string) {
  const payload: OrderSupplierContactedPayload = { orderId, supplierId, outcome, occurredAt: new Date().toISOString() };
  emit(orderId, ORDER_EVENTS.SUPPLIER_CONTACTED, payload);
}

export function emitSupplierAssigned(orderId: string, supplierId: string) {
  const payload: OrderSupplierAssignedPayload = { orderId, supplierId, occurredAt: new Date().toISOString() };
  emit(orderId, ORDER_EVENTS.SUPPLIER_ASSIGNED, payload);
}

export function emitDriverAssigned(orderId: string) {
  const payload: OrderDriverAssignedPayload = { orderId, occurredAt: new Date().toISOString() };
  emit(orderId, ORDER_EVENTS.DRIVER_ASSIGNED, payload);
}

export function emitDeliveryUpdated(orderId: string) {
  const payload: OrderDeliveryUpdatedPayload = { orderId, occurredAt: new Date().toISOString() };
  emit(orderId, ORDER_EVENTS.DELIVERY_UPDATED, payload);
}
