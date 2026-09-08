import { pool } from '../../config/db';

export interface SupplierRow {
  id: string;
  name: string;
  locality: string;
  phone: string | null;
}

/** Deliberately narrower than SupplierRow — no `phone`. This is the shape any authenticated user
 * can see (a contractor viewing a material's detail page needs to know who supplies it), whereas
 * the supplier's phone number is operational contact information only HQ has a reason to see (HQ
 * is who actually calls suppliers — see hq.service.ts) and only listSuppliers/getSuppliers (the
 * HQ-only route) returns it. */
export interface PublicSupplierRow {
  id: string;
  name: string;
  locality: string;
}

export async function getSupplierById(id: string): Promise<PublicSupplierRow | null> {
  const result = await pool.query<PublicSupplierRow>('SELECT id, name, locality FROM suppliers WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function listSuppliers() {
  const result = await pool.query<SupplierRow>('SELECT id, name, locality, phone FROM suppliers ORDER BY name');
  return result.rows;
}
