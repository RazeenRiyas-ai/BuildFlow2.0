import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { summarizeOrderItems } from '@/utils/order-summary';

describe('summarizeOrderItems', () => {
  test('names the single material directly — the pre-Phase-3.3, still-most-common case', () => {
    assert.equal(
      summarizeOrderItems([{ materialName: 'OPC Cement', unit: 'bag', pricePerUnit: 350, quantity: 10 }]),
      '10 bags · OPC Cement',
    );
  });

  test('summarizes by count for more than one item, never naming just one of them', () => {
    assert.equal(
      summarizeOrderItems([
        { materialName: 'OPC Cement', unit: 'bag', pricePerUnit: 350, quantity: 10 },
        { materialName: '20mm Aggregate', unit: 'tonne', pricePerUnit: 1100, quantity: 2 },
      ]),
      '2 items',
    );
  });

  test('returns an empty string for an empty items array', () => {
    assert.equal(summarizeOrderItems([]), '');
  });
});
