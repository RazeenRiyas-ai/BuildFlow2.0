/**
 * Pure routing decision for a tapped order-status push notification — deliberately separated from
 * _layout.tsx's NotificationTapController so it's unit-testable without rendering a React tree or
 * touching expo-notifications/expo-router (see notification-routing.test.ts).
 */

export type NotificationRecipientRole = 'contractor' | 'hq_staff' | 'hq_admin' | undefined;

export interface ResolvedNotificationRoute {
  pathname: '/(hq)/orders/[orderId]' | '/order/[orderId]';
  params: { orderId: string };
}

/** HQ staff/admin land on the HQ order-detail screen; everyone else (a contractor, or — should it
 * ever happen — an unknown/undecoded role) lands on the contractor's own order-detail screen. Never
 * routes anywhere else: both destination screens re-fetch from the normal authenticated REST
 * endpoint and enforce ownership there, so this function's only job is picking the right screen
 * *shape*, never an authorization decision. */
export function resolveOrderNotificationRoute(role: NotificationRecipientRole, orderId: string): ResolvedNotificationRoute {
  if (role === 'hq_staff' || role === 'hq_admin') {
    return { pathname: '/(hq)/orders/[orderId]', params: { orderId } };
  }
  return { pathname: '/order/[orderId]', params: { orderId } };
}

/** Extracts and validates the orderId out of a notification's `data` payload — never trusts it as
 * an authorization claim (see resolveOrderNotificationRoute's own doc and order/[orderId].tsx /
 * (hq)/orders/[orderId].tsx, which both re-check ownership via the real API), only as a value worth
 * attempting to navigate to. Returns null for anything that isn't a non-empty string, which callers
 * treat as "not an order notification — do nothing." */
export function extractOrderIdFromNotificationData(data: Record<string, unknown> | undefined | null): string | null {
  const orderId = data?.orderId;
  return typeof orderId === 'string' && orderId.length > 0 ? orderId : null;
}
