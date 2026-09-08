import { pool } from '../../config/db';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

interface RegisterPushTokenInput {
  expoPushToken: string;
  platform: 'ios' | 'android' | 'web';
}

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

interface OrderForPush {
  id: string;
  site_label: string;
  items: { material_name: string; unit: string; quantity: number | string }[];
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
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

    const item = order.items[0];
    const response = await fetch(env.EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        to: tokens,
        title: 'New order request',
        body: `${item.quantity} ${item.unit} · ${item.material_name} · ${order.site_label}`,
        data: { orderId: order.id },
        sound: 'default',
        priority: 'high',
      }),
    });

    const body = (await response.json().catch(() => null)) as { data?: ExpoPushTicket[] } | null;

    if (!response.ok) {
      logger.error('sendPushToHqDevices: Expo push API rejected the request', undefined, {
        status: response.status,
        body,
      });
      return;
    }

    // Expo returns one ticket per token, in the same order as the `to` array — a 200 response
    // here does not mean every device was actually reachable, so each ticket must be inspected.
    // `expoPushToken` is deliberately named to match the logger's token-truncation rule
    // (utils/logger.ts) — it is never written to the log in full, only a truncated preview, so a
    // specific failing device can still be correlated without exposing the whole token value.
    const tickets: ExpoPushTicket[] = body?.data ?? [];
    tickets.forEach((ticket, index) => {
      if (ticket.status === 'error') {
        logger.error('sendPushToHqDevices: delivery failed for a token', undefined, {
          expoPushToken: tokens[index],
          error: ticket.details?.error ?? ticket.message,
        });
      }
    });
  } catch (err) {
    logger.error('sendPushToHqDevices failed', err);
  }
}
