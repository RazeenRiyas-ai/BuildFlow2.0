import type { AccessTokenPayload } from '../types/auth';
import { getOrderForContractor } from '../modules/orders/orders.service';
import { getOrderForHq } from '../modules/hq/hq.service';

/**
 * Mirrors the exact same ownership/role rules already enforced by the REST endpoints —
 * GET /orders/:id for contractors, GET /hq/orders/:id for HQ — by reusing those exact service
 * functions, so the realtime room-join rule can never drift from the REST authorization rule.
 *
 * Returns a single boolean rather than a reason, so callers can't accidentally reveal *why* a
 * contractor was denied (order doesn't exist vs. belongs to someone else) — exactly like the
 * REST endpoint, which returns an identical 404 for both cases.
 *
 * hq_staff and hq_admin currently have identical access here, matching every other /hq/* route
 * in this codebase (both are gated by role only, with no further per-order restriction).
 */
export async function canJoinOrderRoom(user: AccessTokenPayload, orderId: string): Promise<boolean> {
  if (user.role === 'contractor') {
    const order = await getOrderForContractor(user.sub, orderId);
    return order !== null;
  }

  if (user.role === 'hq_staff' || user.role === 'hq_admin') {
    const order = await getOrderForHq(orderId);
    return order !== null;
  }

  return false;
}
