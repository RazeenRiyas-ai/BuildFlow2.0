import { pool } from '../../config/db';

export interface SiteRow {
  id: string;
  label: string;
  address: string;
  notes: string | null;
}

export async function listSitesForContractor(contractorId: string) {
  const result = await pool.query<SiteRow>(
    `SELECT id, label, address, notes FROM construction_sites
     WHERE contractor_id = $1 AND deleted_at IS NULL
     ORDER BY created_at`,
    [contractorId],
  );
  return result.rows;
}

interface CreateSiteInput {
  label: string;
  address: string;
  notes?: string;
}

export async function createSite(contractorId: string, input: CreateSiteInput) {
  const result = await pool.query<SiteRow>(
    'INSERT INTO construction_sites (contractor_id, label, address, notes) VALUES ($1, $2, $3, $4) RETURNING id, label, address, notes',
    [contractorId, input.label, input.address, input.notes ?? null],
  );
  return result.rows[0];
}
