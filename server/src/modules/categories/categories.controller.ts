import type { Request, Response } from 'express';
import { NotFoundError } from '../../utils/app-error';
import * as categoriesService from './categories.service';
import type { CategoryRow } from './categories.service';

function toApiShape(row: CategoryRow) {
  return {
    id: row.id,
    name: row.name,
    icon: { ios: row.icon_ios, android: row.icon_android, web: row.icon_web },
  };
}

export async function list(_req: Request, res: Response) {
  const rows = await categoriesService.listCategories();
  res.json(rows.map(toApiShape));
}

export async function getById(req: Request, res: Response) {
  const row = await categoriesService.getCategoryById(req.params.id);
  if (!row) throw new NotFoundError('Category not found');
  res.json(toApiShape(row));
}
