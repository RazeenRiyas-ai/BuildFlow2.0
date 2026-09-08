import { OrderStatus } from '@/types/order';
import { UnitOfMeasure } from '@/types/unit';

export interface HqOrderQueueItem {
  id: string;
  status: OrderStatus;
  siteLabel: string;
  siteAddress: string;
  estimatedDeliveryDays: string;
  createdAt: string;
  updatedAt: string;
  contractorName: string;
  contractorPhone: string;
  items: {
    materialName: string;
    unit: UnitOfMeasure;
    pricePerUnit: number;
    quantity: number;
  }[];
}

export interface HqOrderHistoryEntry {
  id: string;
  type: 'status_change' | 'supplier_contact' | 'supplier_assigned' | 'driver_assigned' | 'delivery_update';
  fromStatus?: OrderStatus;
  toStatus?: OrderStatus;
  supplierId?: string;
  contactMethod?: string;
  outcome?: string;
  carrierInfo?: string;
  note?: string;
  actorUserId?: string;
  createdAt: string;
}

export interface HqOrderDetail {
  id: string;
  status: OrderStatus;
  siteLabel: string;
  siteAddress: string;
  estimatedDeliveryDays: string;
  contractorNote?: string;
  assignedSupplierId?: string;
  driverName?: string;
  driverPhone?: string;
  createdAt: string;
  updatedAt: string;
  contractorName: string;
  contractorCompanyName?: string;
  contractorPhone: string;
  items: {
    id: string;
    materialId: string;
    materialName: string;
    unit: UnitOfMeasure;
    pricePerUnit: number;
    quantity: number;
  }[];
  history: HqOrderHistoryEntry[];
}

export interface SupplierContactInput {
  supplierId: string;
  contactMethod: string;
  outcome: string;
  note?: string;
}

export interface AssignSupplierInput {
  supplierId: string;
  note?: string;
}

export interface AssignDriverInput {
  driverName: string;
  driverPhone?: string;
  note?: string;
}
