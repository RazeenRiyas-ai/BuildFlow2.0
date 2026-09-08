import type { Request, Response } from 'express';
import { NotFoundError } from '../../utils/app-error';
import * as contractorsService from './contractors.service';
import type { ContractorRow } from './contractors.service';

function toApiShape(row: ContractorRow) {
  return {
    id: row.id,
    name: row.name,
    companyName: row.company_name ?? undefined,
    phone: row.phone,
  };
}

export async function me(req: Request, res: Response) {
  // requireAuth + requireRole('contractor') run first, so req.user.sub is this contractor's id.
  const contractor = await contractorsService.getContractorById(req.user!.sub);
  if (!contractor) throw new NotFoundError('Contractor not found');
  res.json(toApiShape(contractor));
}
