import { pool } from '../../config/db';

export interface ContractorRow {
  id: string;
  name: string;
  company_name: string | null;
  phone: string;
}

export async function getContractorById(id: string) {
  const result = await pool.query<ContractorRow>(
    'SELECT id, name, company_name, phone FROM contractors WHERE id = $1',
    [id],
  );
  return result.rows[0] ?? null;
}
