import { createContext, PropsWithChildren, use, useEffect, useMemo, useState } from 'react';

import { getOrders, submitOrder as submitOrderService } from '@/services/orders-service';
import { Order, SubmitOrderInput } from '@/types';

interface OrdersContextValue {
  orders: Order[];
  isLoading: boolean;
  submitOrder: (input: SubmitOrderInput) => Promise<Order>;
  getOrderById: (orderId: string) => Order | undefined;
}

const OrdersContext = createContext<OrdersContextValue | null>(null);

/** Submitted material requests, persisted on-device so order history survives app restarts. */
export function OrdersProvider({ children }: PropsWithChildren) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getOrders()
      .then(setOrders)
      .finally(() => setIsLoading(false));
  }, []);

  const value = useMemo<OrdersContextValue>(
    () => ({
      orders,
      isLoading,
      submitOrder: async (input) => {
        const newOrder = await submitOrderService(input);
        setOrders((prev) => [newOrder, ...prev]);
        return newOrder;
      },
      getOrderById: (orderId) => orders.find((order) => order.id === orderId),
    }),
    [orders, isLoading],
  );

  return <OrdersContext value={value}>{children}</OrdersContext>;
}

export function useOrders() {
  const context = use(OrdersContext);
  if (!context) throw new Error('useOrders must be used within an OrdersProvider');
  return context;
}
