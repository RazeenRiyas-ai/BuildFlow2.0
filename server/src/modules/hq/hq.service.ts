import type { PoolClient } from 'pg';
import { pool, withTransaction } from '../../config/db';
import { NotFoundError, ConflictError } from '../../utils/app-error';
import { ErrorCode } from '../../errors/error-codes';
import { transitionOrderStatus, HQ_ACTION_ALLOWED_STATUSES } from '../orders/orders.service';
import type { OrderStatus } from '../orders/orders.service';
import {
  emitSupplierContacted,
  emitSupplierAssigned,
  emitDriverAssigned,
  emitDeliveryUpdated,
} from '../../realtime/order-events';

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
  const orderColumns = 'o.id, o.status, o.site_label, o.site_address, o.estimated_delivery_days, o.contractor_note, o.assigned_supplier_id, o.driver_name, o.driver_phone, o.created_at, o.updated_at';
  const contractorColumns = 'c.name AS contractor_name, c.company_name AS contractor_company_name, c.phone AS contractor_phone';
  const orderSql = 'SELECT ' + orderColumns + ', ' + contractorColumns + ' FROM orders o JOIN contractors c ON c.id = o.contractor_id WHERE o.id = $1';
  const orderResult = await pool.query(orderSql, [orderId]);
  const order = orderResult.rows[0];
  if (!order) return null;

  const itemsSql = 'SELECT id, material_id, material_name, unit, price_per_unit, quantity FROM order_items WHERE order_id = $1 ORDER BY display_order, id';
  const itemsResult = await pool.query(itemsSql, [orderId]);

  const historyColumns = 'id, type, from_status, to_status, supplier_id, contact_method, outcome, carrier_info, note, actor_user_id, created_at';
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

    const supplierResult = await client.query('SELECT id FROM suppliers WHERE id = $1', [input.supplierId]);
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

    const supplierResult = await client.query('SELECT id FROM suppliers WHERE id = $1', [input.supplierId]);
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
  driverName: string;
  driverPhone?: string;
  note?: string;
}

export async function assignDriver(orderId: string, actorUserId: string, input: AssignDriverInput) {
  await withTransaction(async (client) => {
    await lockOrderForAction(client, orderId, HQ_ACTION_ALLOWED_STATUSES.assignDriver, 'assign a driver');

    await client.query('UPDATE orders SET driver_name = $1, driver_phone = $2, updated_at = now() WHERE id = $3', [
      input.driverName,
      input.driverPhone ?? null,
      orderId,
    ]);

    const carrierInfo = input.driverPhone ? `${input.driverName} (${input.driverPhone})` : input.driverName;
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
