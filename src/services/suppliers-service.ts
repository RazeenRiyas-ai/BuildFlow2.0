import { apiClient, ApiError } from '@/services/api-client';
import { Supplier } from '@/types';

export async function getSupplierById(supplierId: string): Promise<Supplier | undefined> {
  try {
    return await apiClient.get<Supplier>('/suppliers/' + supplierId);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) return undefined;
    throw err;
  }
}
