import { pool } from '../../config/db';

export interface SupplierRow {
  id: string;
  name: string;
  locality: string;
  phone: string | null;
  is_active: boolean;
}

/** Deliberately narrower than SupplierRow — no `phone`, no `is_active`. This is the shape any
 * authenticated user can see (a contractor viewing a material's detail page needs to know who
 * supplies it), whereas the supplier's phone number and active/inactive status are operational
 * detail only HQ has a reason to see (HQ is who actually calls/manages suppliers — see
 * hq.service.ts and this module's own create/update). Deliberately NOT filtered by is_active
 * either — a material's supplier_id has no active-status constraint of its own (see
 * materials.service.ts's assertSupplierExists), so a contractor resolving which supplier fulfills
 * a material they're browsing must keep working even if that supplier has since been deactivated
 * for new HQ contact/assignment. This preserves this route's exact pre-existing behavior. */
export interface PublicSupplierRow {
  id: string;
  name: string;
  locality: string;
}

export async function getSupplierById(id: string): Promise<PublicSupplierRow | null> {
  const result = await pool.query<PublicSupplierRow>('SELECT id, name, locality FROM suppliers WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

interface ListSuppliersFilters {
  includeInactive?: boolean;
}

export async function listSuppliers(filters: ListSuppliersFilters = {}) {
  const where = filters.includeInactive ? '' : 'WHERE is_active = true';
  const result = await pool.query<SupplierRow>(`SELECT id, name, locality, phone, is_active FROM suppliers ${where} ORDER BY name`);
  return result.rows;
}

interface CreateSupplierInput {
  name: string;
  locality: string;
  phone?: string;
}

export async function createSupplier(input: CreateSupplierInput) {
  const result = await pool.query<SupplierRow>(
    'INSERT INTO suppliers (name, locality, phone) VALUES ($1, $2, $3) RETURNING id, name, locality, phone, is_active',
    [input.name, input.locality, input.phone ?? null],
  );
  return result.rows[0];
}

export interface UpdateSupplierInput {
  name?: string;
  locality?: string;
  phone?: string | null;
  isActive?: boolean;
}

/** COLUMN_BY_KEY whitelists every column this function is allowed to touch — patch keys are typed
 * (UpdateSupplierInput), so this can never be driven by arbitrary client-supplied field names. */
const COLUMN_BY_KEY: Record<keyof UpdateSupplierInput, string> = {
  name: 'name',
  locality: 'locality',
  phone: 'phone',
  isActive: 'is_active',
};

export async function updateSupplier(id: string, patch: UpdateSupplierInput) {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined) as [keyof UpdateSupplierInput, unknown][];
  if (entries.length === 0) {
    const result = await pool.query<SupplierRow>('SELECT id, name, locality, phone, is_active FROM suppliers WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  const setClauses: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of entries) {
    params.push(value);
    setClauses.push(`${COLUMN_BY_KEY[key]} = $${params.length}`);
  }
  params.push(id);

  const result = await pool.query<SupplierRow>(
    `UPDATE suppliers SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING id, name, locality, phone, is_active`,
    params,
  );
  return result.rows[0] ?? null;
}
