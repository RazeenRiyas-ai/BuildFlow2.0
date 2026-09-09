import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { extractOrderIdFromNotificationData, resolveOrderNotificationRoute } from '@/utils/notification-routing';

describe('resolveOrderNotificationRoute', () => {
  test('routes hq_admin to the HQ order-detail screen', () => {
    assert.deepEqual(resolveOrderNotificationRoute('hq_admin', 'order-1'), {
      pathname: '/(hq)/orders/[orderId]',
      params: { orderId: 'order-1' },
    });
  });

  test('routes hq_staff to the HQ order-detail screen', () => {
    assert.deepEqual(resolveOrderNotificationRoute('hq_staff', 'order-1'), {
      pathname: '/(hq)/orders/[orderId]',
      params: { orderId: 'order-1' },
    });
  });

  test('routes a contractor to their own order-detail screen', () => {
    assert.deepEqual(resolveOrderNotificationRoute('contractor', 'order-2'), {
      pathname: '/order/[orderId]',
      params: { orderId: 'order-2' },
    });
  });

  test('falls back to the contractor screen for an undefined/unknown role — never assumes HQ', () => {
    assert.deepEqual(resolveOrderNotificationRoute(undefined, 'order-3'), {
      pathname: '/order/[orderId]',
      params: { orderId: 'order-3' },
    });
  });
});

describe('extractOrderIdFromNotificationData', () => {
  test('extracts a valid string orderId', () => {
    assert.equal(extractOrderIdFromNotificationData({ orderId: 'abc-123', type: 'order_status_changed' }), 'abc-123');
  });

  test('returns null for missing data', () => {
    assert.equal(extractOrderIdFromNotificationData(undefined), null);
    assert.equal(extractOrderIdFromNotificationData(null), null);
  });

  test('returns null when orderId is absent, empty, or the wrong type — never coerces', () => {
    assert.equal(extractOrderIdFromNotificationData({}), null);
    assert.equal(extractOrderIdFromNotificationData({ orderId: '' }), null);
    assert.equal(extractOrderIdFromNotificationData({ orderId: 12345 }), null);
    assert.equal(extractOrderIdFromNotificationData({ orderId: null }), null);
  });
});
