import { SUPPLIERS } from '@/data/suppliers';
import { Supplier } from '@/types';

export async function getSupplierById(supplierId: string): Promise<Supplier | undefined> {
  return SUPPLIERS.find((supplier) => supplier.id === supplierId);
}
