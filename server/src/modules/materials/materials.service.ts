import { pool } from '../../config/db';

export interface MaterialRow {
  id: string;
  name: string;
  category_id: string;
  supplier_id: string;
  image_url: string | null;
  price_per_unit: string;
  unit: string;
  stock_status: string;
  min_order_quantity: string;
  quantity_step: string;
  estimated_delivery_days: string;
  description: string | null;
  is_featured: boolean;
}

const SELECT_COLUMNS = `id, name, category_id, supplier_id, image_url, price_per_unit, unit, stock_status,
  min_order_quantity, quantity_step, estimated_delivery_days, description, is_featured`;

interface ListFilters {
  categoryId?: string;
  featured?: boolean;
}

export async function listMaterials(filters: ListFilters = {}) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.categoryId) {
    params.push(filters.categoryId);
    conditions.push(`category_id = $${params.length}`);
  }
  if (filters.featured) {
    conditions.push('is_featured = true');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await pool.query<MaterialRow>(`SELECT ${SELECT_COLUMNS} FROM materials ${where} ORDER BY name`, params);
  return result.rows;
}

export async function getMaterialById(id: string) {
  const result = await pool.query<MaterialRow>(`SELECT ${SELECT_COLUMNS} FROM materials WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function searchMaterials(query: string) {
  const result = await pool.query<MaterialRow>(
    `SELECT ${SELECT_COLUMNS} FROM materials WHERE name ILIKE '%' || $1 || '%' ORDER BY name`,
    [query],
  );
  return result.rows;
}
