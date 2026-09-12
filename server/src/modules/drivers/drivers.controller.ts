import type { Request, Response } from 'express';
import { NotFoundError } from '../../utils/app-error';
import { ErrorCode } from '../../errors/error-codes';
import * as driversService from './drivers.service';

/** HQ-only (mounted at /hq/drivers by hq.routes.ts, behind that router's existing
 * `requireAuth, requireRole('hq_staff', 'hq_admin')` gate). Unlike suppliers, drivers have no
 * contractor-facing read surface at all — a contractor only ever sees a driver's name/phone via
 * the snapshot columns on their own order (orders.driver_name/driver_phone), never a direct lookup
 * against this table. */

function toApiShape(row: driversService.DriverRow) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone ?? undefined,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export async function list(req: Request, res: Response) {
  const includeInactive = req.query.includeInactive === 'true';
  const rows = await driversService.listDrivers({ includeInactive });
  res.json(rows.map(toApiShape));
}

export async function getById(req: Request, res: Response) {
  const row = await driversService.getDriverById(req.params.id);
  if (!row) throw new NotFoundError('Driver not found', ErrorCode.DRIVER_NOT_FOUND);
  res.json(toApiShape(row));
}

export async function create(req: Request, res: Response) {
  const row = await driversService.createDriver(req.body);
  res.status(201).json(toApiShape(row));
}

export async function update(req: Request, res: Response) {
  const row = await driversService.updateDriver(req.params.id, req.body);
  if (!row) throw new NotFoundError('Driver not found', ErrorCode.DRIVER_NOT_FOUND);
  res.json(toApiShape(row));
}
