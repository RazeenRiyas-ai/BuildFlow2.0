import type { Request, Response } from 'express';
import { NotFoundError } from '../../utils/app-error';
import { ErrorCode } from '../../errors/error-codes';
import * as materialsService from './materials.service';
import type { MaterialRow } from './materials.service';

function toApiShape(row: MaterialRow) {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.category_id,
    supplierId: row.supplier_id,
    imageUrl: row.image_url ?? undefined,
    pricePerUnit: Number(row.price_per_unit),
    unit: row.unit,
    stockStatus: row.stock_status,
    minOrderQuantity: Number(row.min_order_quantity),
    quantityStep: Number(row.quantity_step),
    estimatedDeliveryDays: row.estimated_delivery_days,
    description: row.description ?? undefined,
  };
}

export async function list(req: Request, res: Response) {
  const featured = req.query.featured === 'true';
  const rows = await materialsService.listMaterials({ featured });
  res.json(rows.map(toApiShape));
}

export async function getById(req: Request, res: Response) {
  const row = await materialsService.getMaterialById(req.params.id);
  if (!row) throw new NotFoundError('Material not found', ErrorCode.MATERIAL_NOT_FOUND);
  res.json(toApiShape(row));
}

export async function listByCategory(req: Request, res: Response) {
  const rows = await materialsService.listMaterials({ categoryId: req.params.id });
  res.json(rows.map(toApiShape));
}

export async function search(req: Request, res: Response) {
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  const rows = await materialsService.searchMaterials(query);
  res.json(rows.map(toApiShape));
}
