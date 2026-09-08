import { OrderStatus } from '@/types';

/**
 * Mirrors server/src/modules/orders/orders.service.ts's ORDER_TRANSITIONS exactly.
 * Used only to decide which action buttons to show — the backend is the sole enforcement
 * authority and will reject an invalid transition with 409 regardless of this map.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  requested: ['supplier_contacted', 'cancelled'],
  supplier_contacted: ['supplier_confirmed', 'supplier_rejected', 'cancelled'],
  supplier_confirmed: ['driver_assigned', 'cancelled'],
  supplier_rejected: ['supplier_contacted', 'cancelled'],
  driver_assigned: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered'],
  delivered: [],
  cancelled: [],
};
