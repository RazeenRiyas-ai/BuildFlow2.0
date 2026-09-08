import type { Request, Response } from 'express';
import { NotFoundError } from '../../utils/app-error';
import { ErrorCode } from '../../errors/error-codes';
import { extractIdempotencyKeyHeader } from '../../idempotency/idempotency-key-header';
import * as ordersService from './orders.service';

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

function toOrderSummaryShape(row: any) {
  return {
    id: row.id,
    status: row.status,
    siteLabel: row.site_label,
    siteAddress: row.site_address,
    estimatedDeliveryDays: row.estimated_delivery_days,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: [
      {
        materialName: row.material_name,
        unit: row.unit,
        pricePerUnit: Number(row.price_per_unit),
        quantity: Number(row.quantity),
      },
    ],
  };
}

function toOrderDetailShape(row: any) {
  return {
    id: row.id,
    status: row.status,
    siteLabel: row.site_label,
    siteAddress: row.site_address,
    estimatedDeliveryDays: row.estimated_delivery_days,
    contractorNote: row.contractor_note ?? undefined,
    assignedSupplierId: row.assigned_supplier_id ?? undefined,
    driverName: row.driver_name ?? undefined,
    driverPhone: row.driver_phone ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: row.items.map(toItemShape),
    history: row.history.map((h: any) => ({
      id: h.id,
      type: h.type,
      fromStatus: h.from_status ?? undefined,
      toStatus: h.to_status ?? undefined,
      note: h.note ?? undefined,
      createdAt: h.created_at,
    })),
  };
}

export async function create(req: Request, res: Response) {
  const contractorId = req.user!.sub;
  // Throws a 400 for a malformed/oversized header; returns undefined if the client sent none at
  // all, in which case createOrder behaves exactly as it did before idempotency existed.
  const idempotencyKey = extractIdempotencyKeyHeader(req);
  const { responseStatus, body } = await ordersService.createOrder(contractorId, req.body, idempotencyKey);
  res.status(responseStatus).json(body);
}

export async function list(req: Request, res: Response) {
  const contractorId = req.user!.sub;
  const rows = await ordersService.listOrdersForContractor(contractorId);
  res.json(rows.map(toOrderSummaryShape));
}

export async function getById(req: Request, res: Response) {
  const contractorId = req.user!.sub;
  const order = await ordersService.getOrderForContractor(contractorId, req.params.id);
  if (!order) throw new NotFoundError('Order not found', ErrorCode.ORDER_NOT_FOUND);
  res.json(toOrderDetailShape(order));
}

export async function cancel(req: Request, res: Response) {
  const contractorId = req.user!.sub;
  await ordersService.cancelOrderForContractor(contractorId, req.params.id);
  res.status(204).send();
}
