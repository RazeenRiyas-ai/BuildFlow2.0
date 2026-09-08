import type { Request, Response } from 'express';
import * as sitesService from './sites.service';
import type { SiteRow } from './sites.service';

function toApiShape(row: SiteRow) {
  return {
    id: row.id,
    label: row.label,
    address: row.address,
    notes: row.notes ?? undefined,
  };
}

export async function list(req: Request, res: Response) {
  // requireAuth + requireRole('contractor') run before this handler, so req.user.sub
  // is the authenticated contractor's id (contractors.id = users.id, see auth.service.ts).
  const contractorId = req.user!.sub;
  const rows = await sitesService.listSitesForContractor(contractorId);
  res.json(rows.map(toApiShape));
}

export async function create(req: Request, res: Response) {
  const contractorId = req.user!.sub;
  const site = await sitesService.createSite(contractorId, req.body);
  res.status(201).json(toApiShape(site));
}
