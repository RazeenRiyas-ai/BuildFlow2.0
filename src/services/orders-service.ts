import { apiClient, ApiError } from '@/services/api-client';
import { Order, OrderDetail, SubmitOrderInput } from '@/types';

export async function getOrders(): Promise<Order[]> {
  return apiClient.get<Order[]>('/orders');
}

export async function getOrderById(orderId: string): Promise<OrderDetail | undefined> {
  try {
    return await apiClient.get<OrderDetail>(`/orders/${orderId}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) return undefined;
    throw err;
  }
}

/** `idempotencyKey` is optional and, when provided, must be generated ONCE per logical submission
 * attempt by the caller (see src/app/order/review.tsx) and reused across any retry of that same
 * attempt — never regenerated per network call. See server/docs/idempotency.md. */
export async function submitOrder(input: SubmitOrderInput, idempotencyKey?: string): Promise<Order> {
  return apiClient.post<Order>('/orders', input, idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined);
}

export async function cancelOrder(orderId: string): Promise<void> {
  await apiClient.patch<void>(`/orders/${orderId}/cancel`);
}
