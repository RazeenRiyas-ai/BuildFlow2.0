import type { PoolClient } from 'pg';
import { pool, withTransaction } from '../../config/db';
import { NotFoundError, ConflictError } from '../../utils/app-error';
import { ErrorCode } from '../../errors/error-codes';
import { logger } from '../../utils/logger';
import { transitionOrderStatus, HQ_ACTION_ALLOWED_STATUSES } from '../orders/orders.service';
import type { OrderStatus } from '../orders/orders.service';
import {
  emitSupplierContacted,
  emitSupplierAssigned,
  emitDriverAssigned,
  emitDeliveryUpdated,
  emitDeliveryChargeSet,
} from '../../realtime/order-events';
import { sendDeliveryChargeSetPushToContractor } from '../push/push.service';

interface ListOrdersFilters {
  status?: OrderStatus;
}

/**
 * One row per order (see orders.service.ts's listOrdersForContractor for the identical reasoning
 * on why this can no longer be a flat, ungrouped JOIN now that an order can have more than one
 * item) — `GROUP BY o.id, c.id` names both joined tables' own primary keys, so every other column
 * from either table is functionally free to select without listing it again.
 */
export async function listOrdersForHq(filters: ListOrdersFilters = {}) {
  const columns = `o.id, o.status, o.site_label, o.site_address, o.estimated_delivery_days, o.created_at, o.updated_at, c.name AS contractor_name, c.phone AS contractor_phone,
    json_agg(json_build_object(
      'material_name', oi.material_name,
      'unit', oi.unit,
      'price_per_unit', oi.price_per_unit,
      'quantity', oi.quantity
    ) ORDER BY oi.display_order, oi.id) AS items`;
  const from = 'FROM orders o JOIN contractors c ON c.id = o.contractor_id JOIN order_items oi ON oi.order_id = o.id';
  const groupBy = 'GROUP BY o.id, c.id';

  if (filters.status) {
    const sql = 'SELECT ' + columns + ' ' + from + ' WHERE o.status = $1 ' + groupBy + ' ORDER BY o.created_at DESC';
    const result = await pool.query(sql, [filters.status]);
    return result.rows;
  }

  const sql = 'SELECT ' + columns + ' ' + from + ' ' + groupBy + ' ORDER BY o.created_at DESC';
  const result = await pool.query(sql);
  return result.rows;
}

export async function getOrderForHq(orderId: string) {
  const orderColumns = 'o.id, o.status, o.site_label, o.site_address, o.estimated_delivery_days, o.contractor_note, o.assigned_supplier_id, o.assigned_driver_id, o.driver_name, o.driver_phone, o.delivery_charge, o.created_at, o.updated_at';
  const contractorColumns = 'c.name AS contractor_name, c.company_name AS contractor_company_name, c.phone AS contractor_phone';
  const orderSql = 'SELECT ' + orderColumns + ', ' + contractorColumns + ' FROM orders o JOIN contractors c ON c.id = o.contractor_id WHERE o.id = $1';
  const orderResult = await pool.query(orderSql, [orderId]);
  const order = orderResult.rows[0];
  if (!order) return null;

  const itemsSql = 'SELECT id, material_id, material_name, unit, price_per_unit, quantity FROM order_items WHERE order_id = $1 ORDER BY display_order, id';
  const itemsResult = await pool.query(itemsSql, [orderId]);

  const historyColumns = 'id, type, from_status, to_status, supplier_id, contact_method, outcome, carrier_info, amount, note, actor_user_id, created_at';
  const historySql = 'SELECT ' + historyColumns + ' FROM order_status_history WHERE order_id = $1 ORDER BY created_at ASC';
  const historyResult = await pool.query(historySql, [orderId]);

  return { ...order, items: itemsResult.rows, history: historyResult.rows };
}

export async function updateOrderStatus(orderId: string, status: OrderStatus, actorUserId: string, note?: string) {
  return transitionOrderStatus(orderId, status, actorUserId, note);
}

/**
 * Locks the order row for the duration of the caller's transaction (blocking any other concurrent
 * mutation on this same order — including a status transition via transitionOrderStatus, which
 * takes the same FOR UPDATE lock — until this transaction commits or rolls back) and validates its
 * CURRENT status against the action being attempted. This is what makes two HQ staff racing on the
 * same order safe: whichever transaction's lock acquisition loses the race re-reads the order's
 * post-first-transaction status and is correctly rejected if that status no longer supports the
 * second action, instead of silently applying a now-nonsensical mutation.
 *
 * Throws NotFoundError if the order doesn't exist, ConflictError if it exists but its status
 * doesn't allow the action. Returns the current status for callers that need it.
 */
async function lockOrderForAction(
  client: PoolClient,
  orderId: string,
  allowedStatuses: readonly OrderStatus[],
  actionDescription: string,
): Promise<OrderStatus> {
  const result = await client.query<{ status: OrderStatus }>('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
  const row = result.rows[0];
  if (!row) throw new NotFoundError('Order not found', ErrorCode.ORDER_NOT_FOUND);
  if (!allowedStatuses.includes(row.status)) {
    throw new ConflictError(`Cannot ${actionDescription} while order is ${row.status}`, ErrorCode.ORDER_ACTION_NOT_ALLOWED, {
      currentStatus: row.status,
    });
  }
  return row.status;
}

interface SupplierContactInput {
  supplierId: string;
  contactMethod: string;
  outcome: string;
  note?: string;
}

export async function recordSupplierContact(orderId: string, actorUserId: string, input: SupplierContactInput) {
  await withTransaction(async (client) => {
    await lockOrderForAction(client, orderId, HQ_ACTION_ALLOWED_STATUSES.supplierContact, 'log a supplier contact');

    // Only an active supplier may be freshly contacted (Phase 3.5) — mirrors assignDriver's own
    // "inactive is treated as not-found" rule. This is purely a gate on NEW actions: suppliers are
    // never snapshotted onto an order (unlike drivers), so this has no bearing on any already-
    // recorded history row, which keeps referencing this same supplier_id regardless of its
    // current active status.
    const supplierResult = await client.query('SELECT id FROM suppliers WHERE id = $1 AND is_active = true', [input.supplierId]);
    if (!supplierResult.rows[0]) throw new NotFoundError('Supplier not found', ErrorCode.SUPPLIER_NOT_FOUND);

    await client.query(
      `INSERT INTO order_status_history (order_id, type, supplier_id, contact_method, outcome, actor_user_id, note)
       VALUES ($1, 'supplier_contact', $2, $3, $4, $5, $6)`,
      [orderId, input.supplierId, input.contactMethod, input.outcome, actorUserId, input.note ?? null],
    );
  });

  // Only reached once the transaction above has committed — a rejected/rolled-back attempt
  // (order not found, wrong status, unknown supplier) never emits.
  emitSupplierContacted(orderId, input.supplierId, input.outcome);
}

interface AssignSupplierInput {
  supplierId: string;
  note?: string;
}

export async function assignSupplier(orderId: string, actorUserId: string, input: AssignSupplierInput) {
  await withTransaction(async (client) => {
    await lockOrderForAction(client, orderId, HQ_ACTION_ALLOWED_STATUSES.assignSupplier, 'assign a supplier');

    // Same "active only" gate as recordSupplierContact above. assigned_supplier_id remains a live
    // pointer, not a snapshot — if this supplier is later deactivated, this order's
    // assigned_supplier_id is untouched and continues to resolve to this same supplier row
    // whenever HQ looks it up, exactly as it always has.
    const supplierResult = await client.query('SELECT id FROM suppliers WHERE id = $1 AND is_active = true', [input.supplierId]);
    if (!supplierResult.rows[0]) throw new NotFoundError('Supplier not found', ErrorCode.SUPPLIER_NOT_FOUND);

    await client.query('UPDATE orders SET assigned_supplier_id = $1, updated_at = now() WHERE id = $2', [input.supplierId, orderId]);

    await client.query(
      `INSERT INTO order_status_history (order_id, type, supplier_id, actor_user_id, note)
       VALUES ($1, 'supplier_assigned', $2, $3, $4)`,
      [orderId, input.supplierId, actorUserId, input.note ?? null],
    );
  });

  emitSupplierAssigned(orderId, input.supplierId);
}

interface AssignDriverInput {
  driverId: string;
  note?: string;
}

/**
 * Looks up the driver and snapshots its current name/phone into orders.driver_name/driver_phone —
 * the same "snapshot at assignment time, never a live join" pattern order_items already uses for
 * material name/price (see orders.service.ts's createOrder). A driver's contact details changing
 * later (or the driver being deactivated) must never retroactively alter what an already-assigned
 * order shows; assigned_driver_id is purely an additional pointer to the canonical record for
 * future reference, not the source of truth an existing screen reads from.
 *
 * Only active drivers can be newly assigned — an inactive one is treated as not found, the same
 * rule materials.service.ts already applies to deactivated materials.
 */
export async function assignDriver(orderId: string, actorUserId: string, input: AssignDriverInput) {
  await withTransaction(async (client) => {
    await lockOrderForAction(client, orderId, HQ_ACTION_ALLOWED_STATUSES.assignDriver, 'assign a driver');

    const driverResult = await client.query<{ name: string; phone: string | null }>(
      'SELECT name, phone FROM drivers WHERE id = $1 AND is_active = true',
      [input.driverId],
    );
    const driver = driverResult.rows[0];
    if (!driver) throw new NotFoundError('Driver not found', ErrorCode.DRIVER_NOT_FOUND);

    await client.query(
      'UPDATE orders SET assigned_driver_id = $1, driver_name = $2, driver_phone = $3, updated_at = now() WHERE id = $4',
      [input.driverId, driver.name, driver.phone, orderId],
    );

    const carrierInfo = driver.phone ? `${driver.name} (${driver.phone})` : driver.name;
    await client.query(
      `INSERT INTO order_status_history (order_id, type, carrier_info, actor_user_id, note)
       VALUES ($1, 'driver_assigned', $2, $3, $4)`,
      [orderId, carrierInfo, actorUserId, input.note ?? null],
    );
  });

  emitDriverAssigned(orderId);
}

export async function recordDeliveryUpdate(orderId: string, actorUserId: string, note: string) {
  await withTransaction(async (client) => {
    await lockOrderForAction(client, orderId, HQ_ACTION_ALLOWED_STATUSES.deliveryUpdate, 'log a delivery update');

    await client.query(
      `INSERT INTO order_status_history (order_id, type, actor_user_id, note)
       VALUES ($1, 'delivery_update', $2, $3)`,
      [orderId, actorUserId, note],
    );
  });

  emitDeliveryUpdated(orderId);
}

interface SetDeliveryChargeInput {
  amount: number;
  note?: string;
}

/**
 * Manually-set delivery charge — never automatically calculated from distance/weight/etc (see
 * orders.service.ts's HQ_ACTION_ALLOWED_STATUSES.setDeliveryCharge for why this status window was
 * chosen: delivery cost isn't knowable until a supplier is confirmed, and stops being editable
 * once the order is delivered or cancelled).
 *
 * NULL vs 0 stays meaningfully distinct: this is only ever called with a real number (the Zod
 * schema at the route layer requires one), so `orders.delivery_charge` only ever moves from NULL
 * to an explicit value here — 0 is HQ deliberately answering "free delivery," never a sentinel for
 * "unset." Editable, not set-once: calling this again for the same order (e.g. a correction after
 * re-checking with the supplier) is a fresh, independent audit row every time, exactly like every
 * other HQ action's history in this file — never an update to a previous row.
 *
 * The push and realtime emit both fire only after the transaction below has committed — a
 * rejected/rolled-back attempt (order not found, wrong status) never notifies anyone.
 */
export async function setDeliveryCharge(orderId: string, actorUserId: string, input: SetDeliveryChargeInput) {
  const { contractorId, siteLabel } = await withTransaction(async (client) => {
    await lockOrderForAction(client, orderId, HQ_ACTION_ALLOWED_STATUSES.setDeliveryCharge, 'set the delivery charge');

    const result = await client.query<{ contractor_id: string; site_label: string }>(
      'UPDATE orders SET delivery_charge = $1, updated_at = now() WHERE id = $2 RETURNING contractor_id, site_label',
      [input.amount, orderId],
    );

    await client.query(
      `INSERT INTO order_status_history (order_id, type, amount, actor_user_id, note)
       VALUES ($1, 'delivery_charge_set', $2, $3, $4)`,
      [orderId, input.amount, actorUserId, input.note ?? null],
    );

    return { contractorId: result.rows[0].contractor_id, siteLabel: result.rows[0].site_label };
  });

  emitDeliveryChargeSet(orderId);

  sendDeliveryChargeSetPushToContractor({ orderId, contractorId, siteLabel, amount: input.amount }).catch((err) =>
    logger.error('sendDeliveryChargeSetPushToContractor failed', err, { orderId }),
  );
}
