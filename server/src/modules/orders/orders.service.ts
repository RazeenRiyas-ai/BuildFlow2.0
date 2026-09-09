import { pool, withTransaction } from '../../config/db';
import { NotFoundError, ConflictError, AppError } from '../../utils/app-error';
import { ErrorCode } from '../../errors/error-codes';
import { sendPushToHqDevices } from '../push/push.service';
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

interface CreateOrderInput {
  materialId: string;
  siteId: string;
  quantity: number;
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
      // Deactivated materials are treated as not found for ordering purposes — the same rule the
      // contractor-facing catalog itself already applies (materials.service.ts's listMaterials /
      // getMaterialById / searchMaterials all filter is_active = true), so a stale deep link or
      // cached material id can never be used to order something HQ just deactivated.
      const materialResult = await client.query(
        'SELECT id, name, unit, price_per_unit, stock_status, min_order_quantity, estimated_delivery_days FROM materials WHERE id = $1 AND is_active = true',
        [input.materialId],
      );
      const material = materialResult.rows[0];
      if (!material) throw new NotFoundError('Material not found', ErrorCode.MATERIAL_NOT_FOUND);
      if (material.stock_status === 'out_of_stock') {
        throw new ConflictError('Material is out of stock', ErrorCode.MATERIAL_OUT_OF_STOCK);
      }
      if (input.quantity < Number(material.min_order_quantity)) {
        throw new AppError(400, 'Quantity is below the minimum order quantity', ErrorCode.INVALID_PARAMETER, {
          field: 'quantity',
          minimum: Number(material.min_order_quantity),
        });
      }

      const siteResult = await client.query(
        'SELECT id, label, address FROM construction_sites WHERE id = $1 AND contractor_id = $2 AND deleted_at IS NULL',
        [input.siteId, contractorId],
      );
      const site = siteResult.rows[0];
      if (!site) throw new NotFoundError('Site not found', ErrorCode.SITE_NOT_FOUND);

      const orderResult = await client.query(
        'INSERT INTO orders (contractor_id, site_id, site_label, site_address, status, estimated_delivery_days, contractor_note) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, contractor_id, site_id, site_label, site_address, status, estimated_delivery_days, contractor_note, assigned_supplier_id, driver_name, driver_phone, created_at, updated_at',
        [contractorId, site.id, site.label, site.address, 'requested', material.estimated_delivery_days, input.note ?? null],
      );
      const order = orderResult.rows[0];

      const itemResult = await client.query(
        'INSERT INTO order_items (order_id, material_id, material_name, unit, price_per_unit, quantity) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, material_id, material_name, unit, price_per_unit, quantity',
        [order.id, material.id, material.name, material.unit, material.price_per_unit, input.quantity],
      );

      await client.query(
        'INSERT INTO order_status_history (order_id, type, to_status, actor_user_id) VALUES ($1, $2, $3, $4)',
        [order.id, 'status_change', 'requested', contractorId],
      );

      const orderWithItems = { ...order, items: [itemResult.rows[0]] };
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

export async function listOrdersForContractor(contractorId: string) {
  const result = await pool.query(
    'SELECT o.id, o.status, o.site_label, o.site_address, o.estimated_delivery_days, o.created_at, o.updated_at, oi.material_name, oi.unit, oi.price_per_unit, oi.quantity FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.contractor_id = $1 ORDER BY o.created_at DESC',
    [contractorId],
  );
  return result.rows;
}

export async function getOrderForContractor(contractorId: string, orderId: string) {
  const orderResult = await pool.query(
    'SELECT id, status, site_label, site_address, estimated_delivery_days, contractor_note, assigned_supplier_id, driver_name, driver_phone, created_at, updated_at FROM orders WHERE id = $1 AND contractor_id = $2',
    [orderId, contractorId],
  );
  const order = orderResult.rows[0];
  if (!order) return null;

  const itemsResult = await pool.query(
    'SELECT id, material_id, material_name, unit, price_per_unit, quantity FROM order_items WHERE order_id = $1',
    [orderId],
  );

  const historyResult = await pool.query(
    'SELECT id, type, from_status, to_status, note, created_at FROM order_status_history WHERE order_id = $1 ORDER BY created_at ASC',
    [orderId],
  );

  return { ...order, items: itemsResult.rows, history: historyResult.rows };
}

export async function transitionOrderStatus(orderId: string, toStatus: OrderStatus, actorUserId: string, note?: string) {
  const fromStatus = await withTransaction(async (client) => {
    const current = await client.query('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (!current.rows[0]) throw new NotFoundError('Order not found', ErrorCode.ORDER_NOT_FOUND);
    const fromStatus: OrderStatus = current.rows[0].status;
    const allowed = ORDER_TRANSITIONS[fromStatus] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new ConflictError('Cannot transition order from ' + fromStatus + ' to ' + toStatus, ErrorCode.ORDER_INVALID_STATUS_TRANSITION);
    }
    await client.query('UPDATE orders SET status = $1, updated_at = now() WHERE id = $2', [toStatus, orderId]);
    await client.query(
      'INSERT INTO order_status_history (order_id, type, from_status, to_status, actor_user_id, note) VALUES ($1, $2, $3, $4, $5, $6)',
      [orderId, 'status_change', fromStatus, toStatus, actorUserId, note ?? null],
    );
    return fromStatus;
  });

  // Only reached if the transaction above committed successfully — withTransaction rejects
  // (after rolling back) on any error, so a failed/invalid transition never emits.
  emitOrderStatusChanged(orderId, fromStatus, toStatus);

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
