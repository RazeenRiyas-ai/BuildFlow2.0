import { pool } from '../../config/db';

export interface DriverRow {
  id: string;
  name: string;
  phone: string | null;
  is_active: boolean;
  created_at: Date;
}

const SELECT_COLUMNS = 'id, name, phone, is_active, created_at';

interface ListDriversFilters {
  includeInactive?: boolean;
}

export async function listDrivers(filters: ListDriversFilters = {}) {
  const where = filters.includeInactive ? '' : 'WHERE is_active = true';
  const result = await pool.query<DriverRow>(`SELECT ${SELECT_COLUMNS} FROM drivers ${where} ORDER BY name`);
  return result.rows;
}

export async function getDriverById(id: string) {
  const result = await pool.query<DriverRow>(`SELECT ${SELECT_COLUMNS} FROM drivers WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

interface CreateDriverInput {
  name: string;
  phone?: string;
}

export async function createDriver(input: CreateDriverInput) {
  const result = await pool.query<DriverRow>(
    `INSERT INTO drivers (name, phone) VALUES ($1, $2) RETURNING ${SELECT_COLUMNS}`,
    [input.name, input.phone ?? null],
  );
  return result.rows[0];
}

export interface UpdateDriverInput {
  name?: string;
  phone?: string | null;
  isActive?: boolean;
}

const COLUMN_BY_KEY: Record<keyof UpdateDriverInput, string> = {
  name: 'name',
  phone: 'phone',
  isActive: 'is_active',
};

export async function updateDriver(id: string, patch: UpdateDriverInput) {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined) as [keyof UpdateDriverInput, unknown][];
  if (entries.length === 0) {
    return getDriverById(id);
  }

  const setClauses: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of entries) {
    params.push(value);
    setClauses.push(`${COLUMN_BY_KEY[key]} = $${params.length}`);
  }
  params.push(id);

  const result = await pool.query<DriverRow>(
    `UPDATE drivers SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING ${SELECT_COLUMNS}`,
    params,
  );
  return result.rows[0] ?? null;
}
