import { createContext, PropsWithChildren, use, useMemo, useState } from 'react';

import type { Cart } from '@/types';
import {
  addItem as addCartItem,
  emptyCart,
  removeItem as removeCartItem,
  setSite as setCartSite,
  updateQuantity as updateCartQuantity,
} from '@/utils/cart';

interface CartContextValue {
  cart: Cart;
  addItem: (materialId: string, quantity: number) => void;
  updateQuantity: (materialId: string, quantity: number) => void;
  removeItem: (materialId: string) => void;
  setSite: (siteId: string) => void;
  reset: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

/** The contractor's in-progress multi-item order (cart) before it's submitted. Never persisted. */
export function CartProvider({ children }: PropsWithChildren) {
  const [cart, setCart] = useState<Cart>(emptyCart());

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      addItem: (materialId, quantity) => setCart((prev) => addCartItem(prev, materialId, quantity)),
      updateQuantity: (materialId, quantity) => setCart((prev) => updateCartQuantity(prev, materialId, quantity)),
      removeItem: (materialId) => setCart((prev) => removeCartItem(prev, materialId)),
      setSite: (siteId) => setCart((prev) => setCartSite(prev, siteId)),
      reset: () => setCart(emptyCart()),
    }),
    [cart],
  );

  return <CartContext value={value}>{children}</CartContext>;
}

export function useCart() {
  const context = use(CartContext);
  if (!context) throw new Error('useCart must be used within a CartProvider');
  return context;
}
