import { UnitOfMeasure } from '@/types/unit';

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
  /** An array so a future multi-item order needs no schema change; MVP always submits exactly one. */
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

/** The in-progress selection before a request is submitted. Never persisted. */
export interface OrderDraft {
  materialId: string | null;
  quantity: number;
  siteId: string | null;
}

export interface SubmitOrderInput {
  materialId: string;
  quantity: number;
  siteId: string;
  note?: string;
}
