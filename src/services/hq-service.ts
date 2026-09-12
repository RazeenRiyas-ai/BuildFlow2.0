import { apiClient, ApiError } from '@/services/api-client';
import {
  AssignDriverInput,
  AssignSupplierInput,
  CreateDriverInput,
  Driver,
  HqOrderDetail,
  HqOrderQueueItem,
  OrderStatus,
  SupplierContactInput,
  Supplier,
  UpdateDriverInput,
} from '@/types';

export async function getHqOrders(status?: OrderStatus): Promise<HqOrderQueueItem[]> {
  const query = status ? '?status=' + status : '';
  return apiClient.get<HqOrderQueueItem[]>('/hq/orders' + query);
}

export async function getHqOrderById(orderId: string): Promise<HqOrderDetail | undefined> {
  try {
    return await apiClient.get<HqOrderDetail>(`/hq/orders/${orderId}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) return undefined;
    throw err;
  }
}

export async function updateHqOrderStatus(orderId: string, status: OrderStatus, note?: string): Promise<void> {
  await apiClient.patch<void>(`/hq/orders/${orderId}/status`, { status, note });
}

export async function recordSupplierContact(orderId: string, input: SupplierContactInput): Promise<void> {
  await apiClient.post<void>(`/hq/orders/${orderId}/supplier-contact`, input);
}

export async function assignSupplier(orderId: string, input: AssignSupplierInput): Promise<void> {
  await apiClient.post<void>(`/hq/orders/${orderId}/assign-supplier`, input);
}

export async function assignDriver(orderId: string, input: AssignDriverInput): Promise<void> {
  await apiClient.post<void>(`/hq/orders/${orderId}/assign-driver`, input);
}

export async function recordDeliveryUpdate(orderId: string, note: string): Promise<void> {
  await apiClient.post<void>(`/hq/orders/${orderId}/delivery-update`, { note });
}

export async function getSuppliers(): Promise<Supplier[]> {
  return apiClient.get<Supplier[]>('/suppliers');
}

export async function getDrivers(includeInactive?: boolean): Promise<Driver[]> {
  const query = includeInactive ? '?includeInactive=true' : '';
  return apiClient.get<Driver[]>('/hq/drivers' + query);
}

export async function createDriver(input: CreateDriverInput): Promise<Driver> {
  return apiClient.post<Driver>('/hq/drivers', input);
}

export async function updateDriver(driverId: string, input: UpdateDriverInput): Promise<Driver> {
  return apiClient.patch<Driver>(`/hq/drivers/${driverId}`, input);
}
