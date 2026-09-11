import { pool } from '../../config/db';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import type { OrderStatus } from '../orders/orders.service';

interface RegisterPushTokenInput {
  expoPushToken: string;
  platform: 'ios' | 'android' | 'web';
}

/** Role-agnostic by design: a push token belongs to an authenticated user, not to a role. Used
 * identically by HQ staff/admin and contractors — the caller's identity always comes from
 * `req.user!.sub` (see push.controller.ts), never from anything client-supplied. */
export async function registerPushToken(userId: string, input: RegisterPushTokenInput) {
  await pool.query(
    `INSERT INTO push_tokens (user_id, expo_push_token, platform)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, expo_push_token)
     DO UPDATE SET platform = EXCLUDED.platform, last_seen_at = now()`,
    [userId, input.expoPushToken, input.platform],
  );
}

export async function unregisterPushToken(userId: string, expoPushToken: string) {
  await pool.query('DELETE FROM push_tokens WHERE user_id = $1 AND expo_push_token = $2', [userId, expoPushToken]);
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface PushMessageContent {
  title: string;
  body: string;
  data: Record<string, unknown>;
}

/**
 * The only Expo ticket-level error that means the token itself is permanently dead (app
 * uninstalled, or the token was revoked at the OS level) — see
 * https://docs.expo.dev/push-notifications/sending-notifications/#push-tickets. Every other error
 * (MessageTooBig, MessageRateExceeded, InvalidCredentials, a transient provider hiccup, ...) says
 * something about this specific send attempt, not that the device is gone, and must never cause a
 * token to be deleted — a contractor/HQ device that's just temporarily unreachable must keep
 * receiving future notifications once whatever was wrong resolves itself.
 */
const PERMANENTLY_INVALID_TOKEN_ERROR = 'DeviceNotRegistered';

/**
 * Shared low-level Expo push sender. Posts to the Expo push API and inspects the per-token ticket
 * array Expo returns in the same order as the `to` array — a 200 HTTP response does not mean every
 * device was actually reachable, so each ticket must be read individually. Never throws: push
 * failure/slowness must never affect whatever database mutation triggered it (see callers below,
 * both of which are fire-and-forget from an already-committed transaction).
 */
async function sendExpoPush(tokens: string[], message: PushMessageContent): Promise<void> {
  if (tokens.length === 0) return;

  try {
    const response = await fetch(env.EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        to: tokens,
        title: message.title,
        body: message.body,
        data: message.data,
        sound: 'default',
        priority: 'high',
      }),
    });

    const body = (await response.json().catch(() => null)) as { data?: ExpoPushTicket[] } | null;

    if (!response.ok) {
      logger.error('sendExpoPush: Expo push API rejected the request', undefined, { status: response.status, body });
      return;
    }

    const tickets: ExpoPushTicket[] = body?.data ?? [];
    const deadTokens: string[] = [];

    tickets.forEach((ticket, index) => {
      if (ticket.status !== 'error') return;
      const errorCode = ticket.details?.error;
      // `expoPushToken` is deliberately named to match the logger's token-truncation rule
      // (utils/logger.ts, TRUNCATE_KEY_PATTERN) — never written to the log in full, only a
      // truncated preview, so a specific failing device can still be correlated without exposing
      // the whole token value.
      logger.error('sendExpoPush: delivery failed for a token', undefined, {
        expoPushToken: tokens[index],
        errorCode,
        message: ticket.message,
      });
      if (errorCode === PERMANENTLY_INVALID_TOKEN_ERROR) {
        deadTokens.push(tokens[index]);
      }
    });

    if (deadTokens.length > 0) {
      await pool.query('DELETE FROM push_tokens WHERE expo_push_token = ANY($1::text[])', [deadTokens]);
      logger.info('sendExpoPush: removed permanently invalid push tokens', { count: deadTokens.length });
    }
  } catch (err) {
    logger.error('sendExpoPush failed', err);
  }
}

interface OrderForPush {
  id: string;
  site_label: string;
  items: { material_name: string; unit: string; quantity: number | string }[];
}

/** Never throws — a push failure or slowness must never affect order creation. */
export async function sendPushToHqDevices(order: OrderForPush) {
  try {
    const result = await pool.query<{ expo_push_token: string }>(
      `SELECT pt.expo_push_token
       FROM push_tokens pt
       JOIN users u ON u.id = pt.user_id
       WHERE u.role IN ('hq_staff', 'hq_admin')`,
    );
    const tokens = result.rows.map((row) => row.expo_push_token);
    if (tokens.length === 0) return;

    // Exactly one item still shows quantity/unit/name directly (the pre-Phase-3.3 behavior,
    // unchanged); more than one summarizes by count — picking one of several materials to show
    // would be arbitrary, and the full list would make this notification unbounded in length.
    const item = order.items[0];
    const summary = order.items.length === 1 ? `${item.quantity} ${item.unit} · ${item.material_name}` : `${order.items.length} items`;
    await sendExpoPush(tokens, {
      title: 'New order request',
      body: `${summary} · ${order.site_label}`,
      data: { type: 'order_created', orderId: order.id },
    });
  } catch (err) {
    logger.error('sendPushToHqDevices failed', err);
  }
}

/**
 * Copy for every order-status transition worth interrupting a contractor for. Deliberately not
 * every entry in OrderStatus: 'requested' has no entry (the contractor is already looking at the
 * app when they submit their own request) and is the only status this map omits — see
 * orders.service.ts's transitionOrderStatus, the single call site, which no-ops via
 * sendOrderStatusPushToContractor's own lookup-miss guard for any status not listed here.
 */
const CONTRACTOR_STATUS_COPY: Partial<Record<OrderStatus, { title: string; body: string }>> = {
  supplier_contacted: { title: 'Order Update', body: 'HQ has reached out to a supplier for your order.' },
  supplier_confirmed: { title: 'Supplier Confirmed', body: 'Your supplier has confirmed your order.' },
  supplier_rejected: { title: 'Finding Another Supplier', body: "We're finding another supplier for your request." },
  driver_assigned: { title: 'Driver Assigned', body: 'Your delivery driver has been assigned.' },
  out_for_delivery: { title: 'Out for Delivery', body: 'Your construction materials are on the way.' },
  delivered: { title: 'Order Delivered', body: 'Your order has been delivered.' },
  cancelled: { title: 'Order Cancelled', body: 'Your order has been cancelled.' },
};

interface ContractorOrderStatusPushInput {
  orderId: string;
  contractorId: string;
  status: OrderStatus;
  /** A single material's name (the pre-Phase-3.3, still-most-common case) or an item-count
   * summary like "3 items" for a multi-item order — never the full item list, which would make
   * this notification body unbounded in length. See orders.service.ts's
   * notifyContractorOfStatusChange, the only caller, for how this is derived. */
  itemSummary: string;
}

/**
 * Never throws — same guarantee as sendPushToHqDevices. Called fire-and-forget from
 * orders.service.ts's transitionOrderStatus, after its transaction has already committed and
 * emitOrderStatusChanged has already fired; a failed/slow push here can never roll back or delay
 * the order mutation that triggered it.
 */
export async function sendOrderStatusPushToContractor(input: ContractorOrderStatusPushInput): Promise<void> {
  const copy = CONTRACTOR_STATUS_COPY[input.status];
  if (!copy) return;

  try {
    const result = await pool.query<{ expo_push_token: string }>('SELECT expo_push_token FROM push_tokens WHERE user_id = $1', [
      input.contractorId,
    ]);
    const tokens = result.rows.map((row) => row.expo_push_token);
    if (tokens.length === 0) return;

    await sendExpoPush(tokens, {
      title: copy.title,
      // Item summary included so a contractor with multiple simultaneous requests can tell them
      // apart from the notification alone — deliberately nothing more (no price, no site address,
      // no contractor/company identity beyond what the device's own owner already knows).
      body: `${copy.body} (${input.itemSummary})`,
      data: { type: 'order_status_changed', orderId: input.orderId, status: input.status },
    });
  } catch (err) {
    logger.error('sendOrderStatusPushToContractor failed', err, { orderId: input.orderId, status: input.status });
  }
}
