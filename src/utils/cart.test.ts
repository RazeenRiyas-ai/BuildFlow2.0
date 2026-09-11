import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { addItem, emptyCart, removeItem, setSite, updateQuantity } from '@/utils/cart';

describe('emptyCart', () => {
  test('starts with no items and no site', () => {
    assert.deepEqual(emptyCart(), { items: [], siteId: null });
  });
});

describe('addItem', () => {
  test('adds a new line for a material not already in the cart', () => {
    const cart = addItem(emptyCart(), 'mat-1', 5);
    assert.deepEqual(cart.items, [{ materialId: 'mat-1', quantity: 5 }]);
  });

  test('appends a second line for a different material, preserving the first', () => {
    let cart = addItem(emptyCart(), 'mat-1', 5);
    cart = addItem(cart, 'mat-2', 2);
    assert.deepEqual(cart.items, [
      { materialId: 'mat-1', quantity: 5 },
      { materialId: 'mat-2', quantity: 2 },
    ]);
  });

  test('adding a material already in the cart merges into the existing line by summing quantities, not creating a duplicate entry', () => {
    let cart = addItem(emptyCart(), 'mat-1', 5);
    cart = addItem(cart, 'mat-1', 3);
    assert.deepEqual(cart.items, [{ materialId: 'mat-1', quantity: 8 }]);
  });

  test('a non-positive quantity is a no-op', () => {
    const cart = emptyCart();
    assert.deepEqual(addItem(cart, 'mat-1', 0), cart);
    assert.deepEqual(addItem(cart, 'mat-1', -1), cart);
  });

  test('never mutates the input cart', () => {
    const original = emptyCart();
    addItem(original, 'mat-1', 5);
    assert.deepEqual(original, { items: [], siteId: null });
  });
});

describe('updateQuantity', () => {
  test('sets an existing line to an absolute quantity', () => {
    let cart = addItem(emptyCart(), 'mat-1', 5);
    cart = updateQuantity(cart, 'mat-1', 12);
    assert.deepEqual(cart.items, [{ materialId: 'mat-1', quantity: 12 }]);
  });

  test('does not affect other lines', () => {
    let cart = addItem(emptyCart(), 'mat-1', 5);
    cart = addItem(cart, 'mat-2', 2);
    cart = updateQuantity(cart, 'mat-1', 12);
    assert.deepEqual(cart.items, [
      { materialId: 'mat-1', quantity: 12 },
      { materialId: 'mat-2', quantity: 2 },
    ]);
  });

  test('a non-positive quantity is ignored — never implicitly removes the line', () => {
    const cart = addItem(emptyCart(), 'mat-1', 5);
    assert.deepEqual(updateQuantity(cart, 'mat-1', 0), cart);
    assert.deepEqual(updateQuantity(cart, 'mat-1', -3), cart);
  });

  test('updating a material not in the cart is a no-op', () => {
    const cart = addItem(emptyCart(), 'mat-1', 5);
    assert.deepEqual(updateQuantity(cart, 'mat-2', 10), cart);
  });
});

describe('removeItem', () => {
  test('removes exactly the named line', () => {
    let cart = addItem(emptyCart(), 'mat-1', 5);
    cart = addItem(cart, 'mat-2', 2);
    cart = removeItem(cart, 'mat-1');
    assert.deepEqual(cart.items, [{ materialId: 'mat-2', quantity: 2 }]);
  });

  test('removing the only item leaves an empty items array, not an empty cart object identity change beyond that', () => {
    const cart = addItem(emptyCart(), 'mat-1', 5);
    const result = removeItem(cart, 'mat-1');
    assert.deepEqual(result.items, []);
  });

  test('removing a material not in the cart is a no-op', () => {
    const cart = addItem(emptyCart(), 'mat-1', 5);
    assert.deepEqual(removeItem(cart, 'mat-2'), cart);
  });
});

describe('setSite', () => {
  test('sets the cart-level site id', () => {
    const cart = setSite(emptyCart(), 'site-1');
    assert.equal(cart.siteId, 'site-1');
  });

  test('does not affect items', () => {
    let cart = addItem(emptyCart(), 'mat-1', 5);
    cart = setSite(cart, 'site-1');
    assert.deepEqual(cart.items, [{ materialId: 'mat-1', quantity: 5 }]);
  });

  test('changing the site overwrites the previous selection, never accumulates', () => {
    let cart = setSite(emptyCart(), 'site-1');
    cart = setSite(cart, 'site-2');
    assert.equal(cart.siteId, 'site-2');
  });
});

describe('a full cart lifecycle, mirroring the review screen’s "clear after successful submit" behavior', () => {
  test('building a cart then resetting to emptyCart() after submit leaves no trace of the previous cart', () => {
    let cart = emptyCart();
    cart = addItem(cart, 'mat-1', 5);
    cart = addItem(cart, 'mat-2', 2);
    cart = setSite(cart, 'site-1');
    assert.equal(cart.items.length, 2);
    assert.equal(cart.siteId, 'site-1');

    // The review screen's own reset() is exactly `setCart(emptyCart())` — asserting the same thing
    // here at the pure-function level.
    const cleared = emptyCart();
    assert.deepEqual(cleared, { items: [], siteId: null });
  });
});
