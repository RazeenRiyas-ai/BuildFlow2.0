import { UnitOfMeasure } from '@/types/unit';

export type OrderStatus = 'requested' | 'confirmed' | 'out_for_delivery' | 'delivered' | 'cancelled';

export interface OrderItem {
  materialId: string;
  materialName: string;
  unit: UnitOfMeasure;
  pricePerUnit: number;
  quantity: number;
}

export interface Order {
  id: string;
  /** An array so a future multi-item order needs no schema change; MVP always submits exactly one. */
  items: OrderItem[];
  siteId: string;
  siteLabel: string;
  siteAddress: string;
  status: OrderStatus;
  createdAt: string;
  estimatedDeliveryDays: string;
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
}
