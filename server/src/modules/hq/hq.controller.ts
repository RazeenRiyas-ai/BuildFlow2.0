import type { Request, Response } from 'express';
import { NotFoundError } from '../../utils/app-error';
import { ErrorCode } from '../../errors/error-codes';
import type { OrderStatus } from '../orders/orders.service';
import * as hqService from './hq.service';

function toItemShape(item: any) {
  return {
    id: item.id,
    materialId: item.material_id,
    materialName: item.material_name,
    unit: item.unit,
    pricePerUnit: Number(item.price_per_unit),
    quantity: Number(item.quantity),
  };
}

function toItemSummaryShape(item: any) {
  return {
    materialName: item.material_name,
    unit: item.unit,
    pricePerUnit: Number(item.price_per_unit),
    quantity: Number(item.quantity),
  };
}

// `row.items` is the json_agg array built by listOrdersForHq's SQL (one row per order, aggregated
// across every order_items row that belongs to it) — see orders.controller.ts's identical shaping
// function for the same reasoning.
function toQueueShape(row: any) {
  return {
    id: row.id,
    status: row.status,
    siteLabel: row.site_label,
    siteAddress: row.site_address,
    estimatedDeliveryDays: row.estimated_delivery_days,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    contractorName: row.contractor_name,
    contractorPhone: row.contractor_phone,
    items: row.items.map(toItemSummaryShape),
  };
}

function toDetailShape(row: any) {
  return {
    id: row.id,
    status: row.status,
    siteLabel: row.site_label,
    siteAddress: row.site_address,
    estimatedDeliveryDays: row.estimated_delivery_days,
    contractorNote: row.contractor_note ?? undefined,
    assignedSupplierId: row.assigned_supplier_id ?? undefined,
    assignedDriverId: row.assigned_driver_id ?? undefined,
    driverName: row.driver_name ?? undefined,
    driverPhone: row.driver_phone ?? undefined,
    // Distinct from `?? undefined`: a delivery charge of exactly 0 must survive as 0, not be
    // coerced away — only a genuinely NULL/undefined DB value becomes `null` here. This is the API
    // boundary where the NULL-vs-0 distinction from the database is preserved into the response
    // shape (see server/migrations/1735610000000_delivery_charge.js and hq.service.ts's
    // setDeliveryCharge for the same rule stated at the DB/service layer).
    deliveryCharge: row.delivery_charge === null || row.delivery_charge === undefined ? null : Number(row.delivery_charge),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    contractorName: row.contractor_name,
    contractorCompanyName: row.contractor_company_name ?? undefined,
    contractorPhone: row.contractor_phone,
    items: row.items.map(toItemShape),
    history: row.history.map((h: any) => ({
      id: h.id,
      type: h.type,
      fromStatus: h.from_status ?? undefined,
      toStatus: h.to_status ?? undefined,
      supplierId: h.supplier_id ?? undefined,
      contactMethod: h.contact_method ?? undefined,
      outcome: h.outcome ?? undefined,
      carrierInfo: h.carrier_info ?? undefined,
      amount: h.amount === null || h.amount === undefined ? undefined : Number(h.amount),
      note: h.note ?? undefined,
      actorUserId: h.actor_user_id ?? undefined,
      createdAt: h.created_at,
    })),
  };
}

export async function list(req: Request, res: Response) {
  // req.query.status is already validated/coerced against orderStatusEnum by the route's
  // validate({ query: listHqOrdersQuerySchema }) middleware before this handler ever runs — this
  // is a type-level narrowing of an already-safe runtime value, not an unchecked cast.
  const status = typeof req.query.status === 'string' ? (req.query.status as OrderStatus) : undefined;
  const rows = await hqService.listOrdersForHq({ status });
  res.json(rows.map(toQueueShape));
}

export async function getById(req: Request, res: Response) {
  const order = await hqService.getOrderForHq(req.params.id);
  if (!order) throw new NotFoundError('Order not found', ErrorCode.ORDER_NOT_FOUND);
  res.json(toDetailShape(order));
}

export async function updateStatus(req: Request, res: Response) {
  const actorUserId = req.user!.sub;
  await hqService.updateOrderStatus(req.params.id, req.body.status, actorUserId, req.body.note);
  res.status(204).send();
}

export async function supplierContact(req: Request, res: Response) {
  const actorUserId = req.user!.sub;
  await hqService.recordSupplierContact(req.params.id, actorUserId, req.body);
  res.status(204).send();
}

export async function assignSupplier(req: Request, res: Response) {
  const actorUserId = req.user!.sub;
  await hqService.assignSupplier(req.params.id, actorUserId, req.body);
  res.status(204).send();
}

export async function assignDriver(req: Request, res: Response) {
  const actorUserId = req.user!.sub;
  await hqService.assignDriver(req.params.id, actorUserId, req.body);
  res.status(204).send();
}

export async function deliveryUpdate(req: Request, res: Response) {
  const actorUserId = req.user!.sub;
  await hqService.recordDeliveryUpdate(req.params.id, actorUserId, req.body.note);
  res.status(204).send();
}

export async function setDeliveryCharge(req: Request, res: Response) {
  const actorUserId = req.user!.sub;
  await hqService.setDeliveryCharge(req.params.id, actorUserId, req.body);
  res.status(204).send();
}
