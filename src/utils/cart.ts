import type { Cart } from '@/types/order';

export function emptyCart(): Cart {
  return { items: [], siteId: null };
}

/**
 * Adding a material already in the cart merges into the existing line (sums quantities) rather
 * than creating a second entry for the same material — the natural, expected behavior for a cart,
 * and what keeps `materialId` unique within `items` (the backend independently re-enforces this
 * same invariant server-side — see orders.service.ts's duplicate-material check — since a client
 * can never be trusted to have actually gone through this function).
 *
 * A non-positive quantity is a no-op: there is nothing sensible to add.
 */
export function addItem(cart: Cart, materialId: string, quantity: number): Cart {
  if (quantity <= 0) return cart;
  const existingIndex = cart.items.findIndex((item) => item.materialId === materialId);
  if (existingIndex === -1) {
    return { ...cart, items: [...cart.items, { materialId, quantity }] };
  }
  const items = cart.items.slice();
  items[existingIndex] = { materialId, quantity: items[existingIndex].quantity + quantity };
  return { ...cart, items };
}

/**
 * Sets a line's quantity to an absolute value. A non-positive quantity is ignored (a no-op) —
 * removing an item from the cart is always an explicit `removeItem` call, never an implicit side
 * effect of setting its quantity to zero.
 */
export function updateQuantity(cart: Cart, materialId: string, quantity: number): Cart {
  if (quantity <= 0) return cart;
  const existingIndex = cart.items.findIndex((item) => item.materialId === materialId);
  if (existingIndex === -1) return cart;
  const items = cart.items.slice();
  items[existingIndex] = { ...items[existingIndex], quantity };
  return { ...cart, items };
}

export function removeItem(cart: Cart, materialId: string): Cart {
  return { ...cart, items: cart.items.filter((item) => item.materialId !== materialId) };
}

export function setSite(cart: Cart, siteId: string): Cart {
  return { ...cart, siteId };
}
