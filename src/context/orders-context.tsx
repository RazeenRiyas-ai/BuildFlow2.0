import { createContext, PropsWithChildren, use, useCallback, useMemo } from 'react';

import { useAuth } from '@/context/auth-context';
import { useAsyncData } from '@/hooks/use-async-data';
import { cancelOrder as cancelOrderService, getOrders, submitOrder as submitOrderService } from '@/services/orders-service';
import { Order, SubmitOrderInput } from '@/types';

interface OrdersContextValue {
  orders: Order[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  submitOrder: (input: SubmitOrderInput, idempotencyKey?: string) => Promise<Order>;
  cancelOrder: (orderId: string) => Promise<void>;
}

const OrdersContext = createContext<OrdersContextValue | null>(null);

/** Contractor's material orders, fetched from the backend once authenticated. */
export function OrdersProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const isContractor = user?.role === 'contractor';

  const fetchOrders = useCallback(() => (isContractor ? getOrders() : Promise.resolve([])), [isContractor]);
  const { data: orders, isLoading, error, refetch, setData: setOrders } = useAsyncData<Order[]>(fetchOrders, []);

  const value = useMemo<OrdersContextValue>(
    () => ({
      orders,
      isLoading,
      error,
      refetch,
      submitOrder: async (input, idempotencyKey) => {
        const newOrder = await submitOrderService(input, idempotencyKey);
        setOrders((prev) => [newOrder, ...prev]);
        return newOrder;
      },
      cancelOrder: async (orderId) => {
        await cancelOrderService(orderId);
        setOrders((prev) => prev.map((order) => (order.id === orderId ? { ...order, status: 'cancelled' } : order)));
      },
    }),
    [orders, isLoading, error, refetch, setOrders],
  );

  return <OrdersContext value={value}>{children}</OrdersContext>;
}

export function useOrders() {
  const context = use(OrdersContext);
  if (!context) throw new Error('useOrders must be used within an OrdersProvider');
  return context;
}
