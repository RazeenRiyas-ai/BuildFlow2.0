import { pool } from '../../config/db';

export interface CategoryRow {
  id: string;
  name: string;
  icon_ios: string | null;
  icon_android: string | null;
  icon_web: string | null;
}

export async function listCategories() {
  const result = await pool.query<CategoryRow>('SELECT id, name, icon_ios, icon_android, icon_web FROM categories ORDER BY name');
  return result.rows;
}

export async function getCategoryById(id: string) {
  const result = await pool.query<CategoryRow>(
    'SELECT id, name, icon_ios, icon_android, icon_web FROM categories WHERE id = $1',
    [id],
  );
  return result.rows[0] ?? null;
}
