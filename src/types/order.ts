import type { UnitOfMeasure } from '@/types/unit';

export type OrderStatus =
  | 'requested'
  | 'supplier_contacted'
  | 'supplier_confirmed'
  | 'supplier_rejected'
  | 'driver_assigned'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

export interface OrderItem {
  materialName: string;
  unit: UnitOfMeasure;
  pricePerUnit: number;
  quantity: number;
}

export interface OrderHistoryEntry {
  id: string;
  type: 'status_change' | 'supplier_contact' | 'supplier_assigned' | 'driver_assigned' | 'delivery_update';
  fromStatus?: OrderStatus;
  toStatus?: OrderStatus;
  note?: string;
  createdAt: string;
}

export interface Order {
  id: string;
  /** One or more items — a single-material order (still the common case) is just the length-1
   * case of the same array, not a distinct shape (Phase 3.3). */
  items: OrderItem[];
  siteLabel: string;
  siteAddress: string;
  status: OrderStatus;
  createdAt: string;
  estimatedDeliveryDays: string;
}

export interface OrderDetail extends Order {
  contractorNote?: string;
  driverName?: string;
  driverPhone?: string;
  history: OrderHistoryEntry[];
}

export interface SubmitOrderItemInput {
  materialId: string;
  quantity: number;
}

export interface SubmitOrderInput {
  siteId: string;
  items: SubmitOrderItemInput[];
  note?: string;
}

export interface CartItem {
  materialId: string;
  quantity: number;
}

/** The in-progress multi-item order before it's submitted. Never persisted — cleared on successful
 * submit, lost if the app is closed mid-build (same lifetime the single-item draft this replaced
 * always had). See utils/cart.ts for the pure functions that operate on this shape. */
export interface Cart {
  items: CartItem[];
  siteId: string | null;
}
