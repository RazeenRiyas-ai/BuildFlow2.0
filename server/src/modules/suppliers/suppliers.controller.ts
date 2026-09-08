import type { Request, Response } from 'express';
import { NotFoundError } from '../../utils/app-error';
import { ErrorCode } from '../../errors/error-codes';
import * as suppliersService from './suppliers.service';

export async function getById(req: Request, res: Response) {
  const supplier = await suppliersService.getSupplierById(req.params.id);
  if (!supplier) throw new NotFoundError('Supplier not found', ErrorCode.SUPPLIER_NOT_FOUND);
  res.json(supplier);
}

export async function list(req: Request, res: Response) {
  const suppliers = await suppliersService.listSuppliers();
  res.json(suppliers);
}
