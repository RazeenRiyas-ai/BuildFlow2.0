import { pool, withTransaction } from '../../config/db';
import { NotFoundError, ConflictError, AppError } from '../../utils/app-error';
import { ErrorCode } from '../../errors/error-codes';
import { sendPushToHqDevices, sendOrderStatusPushToContractor, sendStaleOrderReminderToHqDevices } from '../push/push.service';
import { emitOrderStatusChanged } from '../../realtime/order-events';
import { logger } from '../../utils/logger';
import { runIdempotentOperation, IDEMPOTENCY_SCOPES } from '../../idempotency/idempotency';

export type OrderStatus =
  | 'requested'
  | 'supplier_contacted'
  | 'supplier_confirmed'
  | 'supplier_rejected'
  | 'driver_assigned'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  requested: ['supplier_contacted', 'cancelled'],
  supplier_contacted: ['supplier_confirmed', 'supplier_rejected', 'cancelled'],
  supplier_confirmed: ['driver_assigned', 'cancelled'],
  supplier_rejected: ['supplier_contacted', 'cancelled'],
  driver_assigned: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered'],
  delivered: [],
  cancelled: [],
};

/**
 * Gates for HQ's auxiliary operational actions (hq.service.ts) — logging a supplier contact,
 * assigning a supplier/driver, logging a delivery update. These are distinct from
 * ORDER_TRANSITIONS above: none of these four actions change `orders.status` themselves, but each
 * still only makes sense for some statuses (you can't assign a driver before a supplier has
 * confirmed, and nothing should happen to an order that's already been cancelled out from under
 * you by a concurrent request). Kept alongside ORDER_TRANSITIONS as the single place order-status
 * business rules live, rather than duplicated/invented inside hq.service.ts.
 *
 * These mirror exactly the status sets the HQ order-detail screen already uses to decide which
 * action form to show a human operator (see (hq)/orders/[orderId].tsx's canContactSupplier /
 * canAssignSupplier / canAssignDriver / canLogDelivery) — the UI's own judgment calls, now also
 * enforced authoritatively server-side instead of being trusted as a client-side-only convention.
 */
export const HQ_ACTION_ALLOWED_STATUSES: Record<
  'supplierContact' | 'assignSupplier' | 'assignDriver' | 'deliveryUpdate',
  readonly OrderStatus[]
> = {
  supplierContact: ['requested', 'supplier_contacted', 'supplier_rejected'],
  assignSupplier: ['supplier_contacted', 'supplier_confirmed'],
  assignDriver: ['supplier_confirmed', 'driver_assigned'],
  deliveryUpdate: ['driver_assigned', 'out_for_delivery'],
};

/** The two statuses an order can silently stall in with no further contractor- or HQ-initiated
 * action ever guaranteed to happen next — 'requested' (HQ hasn't yet logged a first supplier
 * contact) and 'supplier_rejected' (HQ hasn't yet re-contacted a different supplier). Every other
 * status either has a human actively driving it forward or is terminal. */
const STALE_REMINDER_STATUSES: readonly OrderStatus[] = ['requested', 'supplier_rejected'];

export interface StaleOrderReminderResult {
  remindedOrderIds: string[];
}

/**
 * Atomically claims every order that has been sitting in STALE_REMINDER_STATUSES for at least
 * `thresholdMinutes` since its last update AND hasn't already been reminded since that same last
 * update, then fires one HQ push per claimed order.
 *
 * The claim is a single UPDATE ... RETURNING (not a SELECT followed by a separate UPDATE): this is
 * what makes it safe under concurrent/overlapping invocations (two ticks of the reminder job
 * racing, or — if this process is ever scaled to more than one instance — two processes racing).
 * Postgres row-locks each matching row for the duration of the UPDATE; a second transaction that
 * reaches the same row blocks until the first commits, then re-evaluates the WHERE clause against
 * the now-committed row, where stale_reminder_sent_at no longer satisfies "NULL or older than
 * updated_at" — so it can never double-claim a row the first transaction already claimed.
 *
 * The dedup marker is `stale_reminder_sent_at` compared against `updated_at`, not a one-time
 * "already reminded ever" flag: every existing HQ action on an order already bumps `updated_at`
 * (see lockOrderForAction's callers and transitionOrderStatus), so any real progress on a
 * previously-reminded order naturally makes it eligible for a fresh reminder if it later stalls
 * again — without this job needing any awareness of what HQ did.
 *
 * This is database-backed by design (not an in-memory cache) so dedup state survives every server
 * restart/deployment: a redeploy can never cause either a duplicate reminder for an order already
 * reminded since its last change, or a lost reminder for one that hasn't been.
 */
export async function sendStaleOrderReminders(thresholdMinutes: number): Promise<StaleOrderReminderResult> {
  const result = await pool.query<{ id: string; site_label: string; status: OrderStatus }>(
    `UPDATE orders
     SET stale_reminder_sent_at = now()
     WHERE status = ANY($2::order_status[])
       AND updated_at < now() - make_interval(mins => $1::int)
       AND (stale_reminder_sent_at IS NULL OR stale_reminder_sent_at < updated_at)
     RETURNING id, site_label, status`,
    [thresholdMinutes, STALE_REMINDER_STATUSES],
  );

  for (const row of result.rows) {
    // Fire-and-forget, exactly like every other push call site in this module — never awaited in
    // a way that could let one slow/failing device delay claiming the next stale order, and never
    // able to undo the claim above even if it fails (sendStaleOrderReminderToHqDevices itself
    // never throws, matching sendPushToHqDevices/sendOrderStatusPushToContractor's own contract).
    sendStaleOrderReminderToHqDevices({ id: row.id, siteLabel: row.site_label, status: row.status }).catch((err) =>
      logger.error('sendStaleOrderReminderToHqDevices failed', err, { orderId: row.id }),
    );
  }

  return { remindedOrderIds: result.rows.map((row) => row.id) };
}

interface CreateOrderItemInput {
  materialId: string;
  quantity: number;
}

interface CreateOrderInput {
  siteId: string;
  items: CreateOrderItemInput[];
  note?: string;
}

/** The exact shape orders.controller.ts's `create` handler sends to the client — built here
 * (rather than in the controller, as every other order-shaping function is) specifically because
 * Phase 2.6.7's idempotency guarantee requires storing this exact response in the SAME database
 * transaction that creates the order (see idempotency.ts). A replay years-later-in-practice (a
 * retried request) must return byte-for-byte this same body, not a freshly re-derived one from
 * the order's possibly-since-changed current state. */
function toCreateOrderResponseBody(order: {
  id: string;
  status: OrderStatus;
  site_label: string;
  site_address: string;
  estimated_delivery_days: string;
  contractor_note: string | null;
  created_at: Date;
  updated_at: Date;
  items: { id: string; material_id: string; material_name: string; unit: string; price_per_unit: string; quantity: string }[];
}) {
  return {
    id: order.id,
    status: order.status,
    siteLabel: order.site_label,
    siteAddress: order.site_address,
    estimatedDeliveryDays: order.estimated_delivery_days,
    contractorNote: order.contractor_note ?? undefined,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    items: order.items.map((item) => ({
      id: item.id,
      materialId: item.material_id,
      materialName: item.material_name,
      unit: item.unit,
      pricePerUnit: Number(item.price_per_unit),
      quantity: Number(item.quantity),
    })),
  };
}

export type CreateOrderResponseBody = ReturnType<typeof toCreateOrderResponseBody>;

/**
 * `idempotencyKey` is optional and, when omitted, this behaves exactly as it did before Phase
 * 2.6.7 (a plain transactional create, no dedup bookkeeping at all) — see runIdempotentOperation's
 * own docs for why that's safe/correct. When provided, order creation, the idempotency claim, and
 * storing the response for replay all happen inside one transaction.
 */
export async function createOrder(contractorId: string, input: CreateOrderInput, idempotencyKey?: string) {
  // Set (only on the fresh-create path, from inside the transaction below) so the push
  // notification — a side effect that must never be replayed — only fires once, for the request
  // that actually created the order, never for a replayed retry.
  let createdOrderForPush: { id: string; site_label: string; items: { material_name: string; unit: string; quantity: string }[] } | undefined;

  const { responseStatus, body, replayed } = await runIdempotentOperation<CreateOrderResponseBody>(
    { userId: contractorId, scope: IDEMPOTENCY_SCOPES.ORDERS_CREATE, idempotencyKey, requestPayload: input },
    async (client) => {
      const siteResult = await client.query(
        'SELECT id, label, address FROM construction_sites WHERE id = $1 AND contractor_id = $2 AND deleted_at IS NULL',
        [input.siteId, contractorId],
      );
      const site = siteResult.rows[0];
      if (!site) throw new NotFoundError('Site not found', ErrorCode.SITE_NOT_FOUND);

      // Every item is fetched and validated BEFORE any INSERT happens — a failure on item 3 of 5
      // must never leave items 1-2 already written. This loop only reads; nothing is persisted
      // until every item in the array has passed every check, and even then the whole thing runs
      // inside runIdempotentOperation's own transaction, so a later failure (or a crash) rolls back
      // any already-validated items' inserts too, not just this loop's own reads.
      const validatedItems: {
        material: { id: string; name: string; unit: string; price_per_unit: string; estimated_delivery_days: string };
        quantity: number;
      }[] = [];

      for (const itemInput of input.items) {
        // Deactivated materials are treated as not found for ordering purposes — the same rule the
        // contractor-facing catalog itself already applies (materials.service.ts's listMaterials /
        // getMaterialById / searchMaterials all filter is_active = true), so a stale deep link or
        // cached material id can never be used to order something HQ just deactivated.
        const materialResult = await client.query(
          'SELECT id, name, unit, price_per_unit, stock_status, min_order_quantity, estimated_delivery_days FROM materials WHERE id = $1 AND is_active = true',
          [itemInput.materialId],
        );
        const material = materialResult.rows[0];
        if (!material) {
          throw new NotFoundError('Material not found', ErrorCode.MATERIAL_NOT_FOUND, { materialId: itemInput.materialId });
        }
        if (material.stock_status === 'out_of_stock') {
          throw new ConflictError('Material is out of stock', ErrorCode.MATERIAL_OUT_OF_STOCK, { materialId: material.id });
        }
        if (itemInput.quantity < Number(material.min_order_quantity)) {
          throw new AppError(400, 'Quantity is below the minimum order quantity', ErrorCode.INVALID_PARAMETER, {
            field: 'quantity',
            minimum: Number(material.min_order_quantity),
            materialId: material.id,
          });
        }
        validatedItems.push({ material, quantity: itemInput.quantity });
      }

      // A cart can never legitimately contain the same material twice (that's just a larger
      // quantity of one line) — reject it here as defense in depth against a client bug/tamper
      // rather than relying solely on the frontend cart's own merge-on-add behavior, per "never
      // trust frontend validation."
      const materialIds = validatedItems.map((v) => v.material.id);
      if (new Set(materialIds).size !== materialIds.length) {
        throw new AppError(400, 'Duplicate material in order items', ErrorCode.INVALID_PARAMETER);
      }

      // orders.estimated_delivery_days stays a single per-order field (unchanged column) — for a
      // multi-item order this shows the first item's own estimate. A real per-material aggregate
      // delivery estimate (e.g. "worst case across all items") is a genuine future refinement, but
      // inventing that parsing logic now would be scope creep this phase deliberately avoids; this
      // is an honest simplification, not a hidden one, and is exactly the existing single-item
      // behavior for the one-item case.
      const estimatedDeliveryDays = validatedItems[0].material.estimated_delivery_days;

      const orderResult = await client.query(
        'INSERT INTO orders (contractor_id, site_id, site_label, site_address, status, estimated_delivery_days, contractor_note) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, contractor_id, site_id, site_label, site_address, status, estimated_delivery_days, contractor_note, assigned_supplier_id, driver_name, driver_phone, created_at, updated_at',
        [contractorId, site.id, site.label, site.address, 'requested', estimatedDeliveryDays, input.note ?? null],
      );
      const order = orderResult.rows[0];

      const insertedItems: { id: string; material_id: string; material_name: string; unit: string; price_per_unit: string; quantity: string }[] =
        [];
      for (let index = 0; index < validatedItems.length; index += 1) {
        const { material, quantity } = validatedItems[index];
        const itemResult = await client.query(
          'INSERT INTO order_items (order_id, material_id, material_name, unit, price_per_unit, quantity, display_order) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, material_id, material_name, unit, price_per_unit, quantity',
          [order.id, material.id, material.name, material.unit, material.price_per_unit, quantity, index],
        );
        insertedItems.push(itemResult.rows[0]);
      }

      await client.query(
        'INSERT INTO order_status_history (order_id, type, to_status, actor_user_id) VALUES ($1, $2, $3, $4)',
        [order.id, 'status_change', 'requested', contractorId],
      );

      const orderWithItems = { ...order, items: insertedItems };
      createdOrderForPush = orderWithItems;

      return { responseStatus: 201, body: toCreateOrderResponseBody(orderWithItems), resourceId: order.id as string };
    },
  );

  if (replayed) {
    logger.info('Order creation replayed from idempotency key — no new order created', { contractorId, orderId: body.id });
  } else {
    logger.info('Order created', { orderId: body.id, contractorId, siteId: input.siteId });
    if (createdOrderForPush) {
      sendPushToHqDevices(createdOrderForPush).catch((err) => logger.error('push send failed', err, { orderId: body.id }));
    }
  }

  return { responseStatus, body };
}

/**
 * One row per order, each with a `items` JSON array aggregated across every order_items row that
 * belongs to it — `GROUP BY o.id` alone is enough for Postgres to treat every other o.* column as
 * functionally dependent (same table, same primary key), so none of them need listing separately.
 * Before Phase 3.3 this JOIN produced one row per *item*, which was only ever safe because every
 * order had exactly one; a multi-item order under that old query would have appeared as several
 * duplicate order rows, once per item.
 */
export async function listOrdersForContractor(contractorId: string) {
  const result = await pool.query(
    `SELECT o.id, o.status, o.site_label, o.site_address, o.estimated_delivery_days, o.created_at, o.updated_at,
       json_agg(json_build_object(
         'material_name', oi.material_name,
         'unit', oi.unit,
         'price_per_unit', oi.price_per_unit,
         'quantity', oi.quantity
       ) ORDER BY oi.display_order, oi.id) AS items
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     WHERE o.contractor_id = $1
     GROUP BY o.id
     ORDER BY o.created_at DESC`,
    [contractorId],
  );
  return result.rows;
}

export async function getOrderForContractor(contractorId: string, orderId: string) {
  const orderResult = await pool.query(
    'SELECT id, status, site_label, site_address, estimated_delivery_days, contractor_note, assigned_supplier_id, assigned_driver_id, driver_name, driver_phone, created_at, updated_at FROM orders WHERE id = $1 AND contractor_id = $2',
    [orderId, contractorId],
  );
  const order = orderResult.rows[0];
  if (!order) return null;

  const itemsResult = await pool.query(
    'SELECT id, material_id, material_name, unit, price_per_unit, quantity FROM order_items WHERE order_id = $1 ORDER BY display_order, id',
    [orderId],
  );

  // contact_method/outcome included (Phase 3.6) so a contractor whose order bounces through
  // supplier_rejected can see HQ's own reason (e.g. "Phone call · Out of stock"), not just a bare
  // status change. Deliberately still excludes supplier_id/carrier_info/actor_user_id — this is
  // the same privacy boundary as before, just no longer withholding the two fields that actually
  // explain what happened.
  const historyResult = await pool.query(
    'SELECT id, type, from_status, to_status, contact_method, outcome, note, created_at FROM order_status_history WHERE order_id = $1 ORDER BY created_at ASC',
    [orderId],
  );

  return { ...order, items: itemsResult.rows, history: historyResult.rows };
}

/**
 * Looks up the contractor and a safe item-count-aware summary of the order's contents, then fires
 * the push — entirely after the caller's transaction has already committed, and never awaited by
 * the caller (see its one call site in transitionOrderStatus below): a slow or failing lookup/push
 * here can never delay or fail the HTTP response for the status-change request that triggered it.
 * sendOrderStatusPushToContractor itself already never throws; this wrapper only exists to isolate
 * the (rare, harmless-to-lose) case where the order_items lookup itself fails.
 */
async function notifyContractorOfStatusChange(orderId: string, contractorId: string, toStatus: OrderStatus): Promise<void> {
  const itemsResult = await pool.query<{ material_name: string }>(
    'SELECT material_name FROM order_items WHERE order_id = $1 ORDER BY display_order, id',
    [orderId],
  );
  // Exactly one item names it directly (unchanged from before Phase 3.3, the single-item
  // degenerate case); more than one summarizes by count instead of picking one name arbitrarily —
  // still safe content (no price/address), just no longer assumes there's only ever one material.
  const itemNames = itemsResult.rows.map((row) => row.material_name);
  const itemSummary = itemNames.length === 0 ? 'your order' : itemNames.length === 1 ? itemNames[0] : `${itemNames.length} items`;
  await sendOrderStatusPushToContractor({ orderId, contractorId, status: toStatus, itemSummary });
}

export async function transitionOrderStatus(orderId: string, toStatus: OrderStatus, actorUserId: string, note?: string) {
  const { fromStatus, contractorId } = await withTransaction(async (client) => {
    const current = await client.query('SELECT status, contractor_id FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (!current.rows[0]) throw new NotFoundError('Order not found', ErrorCode.ORDER_NOT_FOUND);
    const fromStatus: OrderStatus = current.rows[0].status;
    const contractorId: string = current.rows[0].contractor_id;
    const allowed = ORDER_TRANSITIONS[fromStatus] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new ConflictError('Cannot transition order from ' + fromStatus + ' to ' + toStatus, ErrorCode.ORDER_INVALID_STATUS_TRANSITION);
    }
    await client.query('UPDATE orders SET status = $1, updated_at = now() WHERE id = $2', [toStatus, orderId]);
    await client.query(
      'INSERT INTO order_status_history (order_id, type, from_status, to_status, actor_user_id, note) VALUES ($1, $2, $3, $4, $5, $6)',
      [orderId, 'status_change', fromStatus, toStatus, actorUserId, note ?? null],
    );
    return { fromStatus, contractorId };
  });

  // Only reached if the transaction above committed successfully — withTransaction rejects
  // (after rolling back) on any error, so a failed/invalid transition never emits or pushes. A
  // retried/duplicate request for the same target status is already rejected above (transitioning
  // *into* a status you're already in is never in ORDER_TRANSITIONS' allowed list for that status),
  // so this single call site can never double-fire for the same logical event — no separate
  // dedup bookkeeping needed for either the socket emit or the push below.
  emitOrderStatusChanged(orderId, fromStatus, toStatus);
  notifyContractorOfStatusChange(orderId, contractorId, toStatus).catch((err) =>
    logger.error('notifyContractorOfStatusChange failed', err, { orderId, toStatus }),
  );

  return toStatus;
}

export async function cancelOrderForContractor(contractorId: string, orderId: string) {
  const orderResult = await pool.query('SELECT status FROM orders WHERE id = $1 AND contractor_id = $2', [orderId, contractorId]);
  const order = orderResult.rows[0];
  if (!order) throw new NotFoundError('Order not found', ErrorCode.ORDER_NOT_FOUND);
  if (order.status !== 'requested') {
    throw new ConflictError(
      'Only orders that are still requested can be cancelled by the contractor',
      ErrorCode.ORDER_CANNOT_BE_CANCELLED,
    );
  }
  return transitionOrderStatus(orderId, 'cancelled', contractorId);
}
