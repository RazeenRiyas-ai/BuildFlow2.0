import type { Request, Response } from 'express';
import { NotFoundError } from '../../utils/app-error';
import { ErrorCode } from '../../errors/error-codes';
import * as suppliersService from './suppliers.service';

/** Full HQ-operational shape — unlike getById's PublicSupplierRow, this is only ever reached
 * through routes already gated to hq_staff/hq_admin (see suppliers.routes.ts). Passes `phone`
 * through as-is (null, not coerced to undefined) — this preserves GET /suppliers' exact
 * pre-existing wire format (it used to `res.json` the raw DB row directly), which the existing
 * "GET /suppliers" test asserts on: the key is always present, even when a supplier has no phone. */
function toApiShape(row: suppliersService.SupplierRow) {
  return {
    id: row.id,
    name: row.name,
    locality: row.locality,
    phone: row.phone,
    isActive: row.is_active,
  };
}

export async function getById(req: Request, res: Response) {
  const supplier = await suppliersService.getSupplierById(req.params.id);
  if (!supplier) throw new NotFoundError('Supplier not found', ErrorCode.SUPPLIER_NOT_FOUND);
  res.json(supplier);
}

export async function list(req: Request, res: Response) {
  const includeInactive = req.query.includeInactive === 'true';
  const suppliers = await suppliersService.listSuppliers({ includeInactive });
  res.json(suppliers.map(toApiShape));
}

export async function create(req: Request, res: Response) {
  const supplier = await suppliersService.createSupplier(req.body);
  res.status(201).json(toApiShape(supplier));
}

export async function update(req: Request, res: Response) {
  const supplier = await suppliersService.updateSupplier(req.params.id, req.body);
  if (!supplier) throw new NotFoundError('Supplier not found', ErrorCode.SUPPLIER_NOT_FOUND);
  res.json(toApiShape(supplier));
}
