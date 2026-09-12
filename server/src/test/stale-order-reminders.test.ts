import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { pool } from '../config/db';
import { sendStaleOrderReminders } from '../modules/orders/orders.service';
import { deleteUserByPhone, uniquePhone } from './db-helpers';

/** Polls `check` until it returns true or `timeoutMs` elapses — sendStaleOrderReminders never
 * awaits its own push sends (fire-and-forget, matching every other push call site in this
 * codebase — see its own doc comment), so the underlying fetch call can genuinely still be
 * in-flight for a few ticks after the function's returned promise has already resolved. Mirrors
 * push.test.ts's own identical helper for the same reason. */
async function waitFor(check: () => boolean, timeoutMs = 1000, intervalMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition never became true within ' + timeoutMs + 'ms');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * sendStaleOrderReminders is tested directly (not via HTTP — there is no route for it; it's only
 * ever invoked by the periodic job in jobs/stale-order-reminder-job.ts, which is deliberately not
 * imported by any test — see that file's own comment on why it's only ever started from
 * server.ts). Orders are created through the real POST /orders endpoint (matching every other
 * test file's convention); their updated_at/stale_reminder_sent_at are then backdated via direct
 * SQL — the one piece of state no API call can otherwise control — to simulate staleness without
 * a test actually waiting hours.
 */
describe('sendStaleOrderReminders (Phase 3.6)', () => {
  const contractorPhone = uniquePhone();
  const password = 'password123';
  const hqPhone = '+91 90000 00001';
  const pushToken = 'ExponentPushToken[stale-reminder-test]';
  let contractorToken: string;
  let hqUserId: string;
  let siteId: string;
  let materialId: string;
  let minOrderQuantity: number;
  const orderIds: string[] = [];

  beforeAll(async () => {
    const reg = await request(app).post('/auth/register').send({ name: 'Stale Reminder Tester', phone: contractorPhone, password });
    contractorToken = reg.body.accessToken;
    const contractorId = reg.body.user.id;

    const siteResult = await pool.query(
      'INSERT INTO construction_sites (contractor_id, label, address) VALUES ($1, $2, $3) RETURNING id',
      [contractorId, 'Stale Reminder Test Site', 'Stale Reminder Test Address'],
    );
    siteId = siteResult.rows[0].id;

    const materials = await request(app).get('/materials');
    const inStock = materials.body.find((m: any) => m.stockStatus === 'in_stock');
    materialId = inStock.id;
    minOrderQuantity = inStock.minOrderQuantity;

    const hqLogin = await request(app).post('/auth/login').send({ phone: hqPhone, password: 'password123' });
    hqUserId = hqLogin.body.user.id;
    await request(app)
      .post('/push/register')
      .set('Authorization', 'Bearer ' + hqLogin.body.accessToken)
      .send({ expoPushToken: pushToken, platform: 'ios' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (orderIds.length > 0) {
      await pool.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [orderIds]);
    }
    await pool.query('DELETE FROM construction_sites WHERE id = $1', [siteId]);
    await deleteUserByPhone(contractorPhone);
    await pool.query('DELETE FROM push_tokens WHERE user_id = $1 AND expo_push_token = $2', [hqUserId, pushToken]);
  });

  async function createOrder(): Promise<string> {
    const res = await request(app)
      .post('/orders')
      .set('Authorization', 'Bearer ' + contractorToken)
      .send({ siteId, items: [{ materialId, quantity: minOrderQuantity }] });
    const id = res.body.id as string;
    orderIds.push(id);
    return id;
  }

  /** Directly backdates an order's updated_at/status/stale_reminder_sent_at — the one piece of
   * state this test needs to control that no API call can set directly. */
  async function backdate(
    orderId: string,
    fields: { status?: string; updatedAtHoursAgo?: number; staleReminderSentAtHoursAgo?: number | null },
  ) {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    if (fields.status !== undefined) {
      params.push(fields.status);
      setClauses.push(`status = $${params.length}::order_status`);
    }
    if (fields.updatedAtHoursAgo !== undefined) {
      params.push(fields.updatedAtHoursAgo);
      setClauses.push(`updated_at = now() - make_interval(hours => $${params.length}::int)`);
    }
    if (fields.staleReminderSentAtHoursAgo === null) {
      setClauses.push('stale_reminder_sent_at = NULL');
    } else if (fields.staleReminderSentAtHoursAgo !== undefined) {
      params.push(fields.staleReminderSentAtHoursAgo);
      setClauses.push(`stale_reminder_sent_at = now() - make_interval(hours => $${params.length}::int)`);
    }
    params.push(orderId);
    await pool.query(`UPDATE orders SET ${setClauses.join(', ')} WHERE id = $${params.length}`, params);
  }

  it('reminds an order stuck in requested past the threshold, and records stale_reminder_sent_at', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ status: 'ok' }] }), { status: 200 }));
    const orderId = await createOrder();
    await backdate(orderId, { status: 'requested', updatedAtHoursAgo: 5, staleReminderSentAtHoursAgo: null });

    const { remindedOrderIds } = await sendStaleOrderReminders(240);
    expect(remindedOrderIds).toContain(orderId);

    const row = await pool.query('SELECT stale_reminder_sent_at FROM orders WHERE id = $1', [orderId]);
    expect(row.rows[0].stale_reminder_sent_at).not.toBeNull();
  });

  it('reminds an order stuck in supplier_rejected past the threshold', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ status: 'ok' }] }), { status: 200 }));
    const orderId = await createOrder();
    await backdate(orderId, { status: 'supplier_rejected', updatedAtHoursAgo: 5, staleReminderSentAtHoursAgo: null });

    const { remindedOrderIds } = await sendStaleOrderReminders(240);
    expect(remindedOrderIds).toContain(orderId);
  });

  it('does not remind an order that has not been stale long enough', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ status: 'ok' }] }), { status: 200 }));
    const orderId = await createOrder();
    // Freshly created — updated_at is "now", nowhere near the 240-minute threshold.

    const { remindedOrderIds } = await sendStaleOrderReminders(240);
    expect(remindedOrderIds).not.toContain(orderId);
  });

  it('does not remind an order in a status outside requested/supplier_rejected, even if old', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ status: 'ok' }] }), { status: 200 }));
    const orderId = await createOrder();
    await backdate(orderId, { status: 'supplier_confirmed', updatedAtHoursAgo: 5, staleReminderSentAtHoursAgo: null });

    const { remindedOrderIds } = await sendStaleOrderReminders(240);
    expect(remindedOrderIds).not.toContain(orderId);
  });

  it('does not remind an order already reminded since its last update (no duplicate reminder)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ status: 'ok' }] }), { status: 200 }));
    const orderId = await createOrder();
    // Reminded 1 hour ago, updated 5 hours ago — the reminder is newer than the last update, so
    // nothing has changed since HQ was already notified.
    await backdate(orderId, { status: 'requested', updatedAtHoursAgo: 5, staleReminderSentAtHoursAgo: 1 });

    const { remindedOrderIds } = await sendStaleOrderReminders(240);
    expect(remindedOrderIds).not.toContain(orderId);
  });

  it('reminds again once the order has changed since its last reminder and gone stale again', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ status: 'ok' }] }), { status: 200 }));
    const orderId = await createOrder();
    // Reminded 10 hours ago, but updated (i.e. something happened) only 5 hours ago — the update
    // is newer than the reminder, so this counts as a fresh stale spell.
    await backdate(orderId, { status: 'requested', updatedAtHoursAgo: 5, staleReminderSentAtHoursAgo: 10 });

    const { remindedOrderIds } = await sendStaleOrderReminders(240);
    expect(remindedOrderIds).toContain(orderId);
  });

  it('is idempotent across consecutive calls: a just-reminded order is not immediately re-reminded', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ status: 'ok' }] }), { status: 200 }));
    const orderId = await createOrder();
    await backdate(orderId, { status: 'requested', updatedAtHoursAgo: 5, staleReminderSentAtHoursAgo: null });

    const first = await sendStaleOrderReminders(240);
    expect(first.remindedOrderIds).toContain(orderId);

    const second = await sendStaleOrderReminders(240);
    expect(second.remindedOrderIds).not.toContain(orderId);
  });

  it('sends exactly one push per reminded order, addressed to registered HQ devices', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ status: 'ok' }] }), { status: 200 }));
    const orderId = await createOrder();
    await backdate(orderId, { status: 'requested', updatedAtHoursAgo: 5, staleReminderSentAtHoursAgo: null });

    await sendStaleOrderReminders(240);

    function relevantCalls() {
      // Filtered by type as well as orderId — createOrder() above also fires its own
      // fire-and-forget "New order request" push to the same HQ devices (see orders.service.ts's
      // createOrder), which would otherwise be a false match on orderId alone.
      return fetchSpy.mock.calls.filter((call) => {
        const body = JSON.parse(String((call[1] as RequestInit)?.body ?? '{}'));
        return body.data?.orderId === orderId && body.data?.type === 'order_stale_reminder';
      });
    }
    await waitFor(() => relevantCalls().length > 0);

    const calls = relevantCalls();
    expect(calls).toHaveLength(1);
    const sentBody = JSON.parse(String((calls[0][1] as RequestInit).body));
    expect(sentBody.to).toContain(pushToken);
    expect(sentBody.data).toEqual({ type: 'order_stale_reminder', orderId });
  });

  it('never throws when the push send itself fails — the claim is unaffected', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
    const orderId = await createOrder();
    await backdate(orderId, { status: 'requested', updatedAtHoursAgo: 5, staleReminderSentAtHoursAgo: null });

    const { remindedOrderIds } = await sendStaleOrderReminders(240);
    expect(remindedOrderIds).toContain(orderId);

    const row = await pool.query('SELECT stale_reminder_sent_at FROM orders WHERE id = $1', [orderId]);
    expect(row.rows[0].stale_reminder_sent_at).not.toBeNull();
  });
});

afterAll(async () => {
  await pool.end();
});
