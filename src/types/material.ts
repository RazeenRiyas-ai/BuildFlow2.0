import { CategoryId } from '@/types/category';
import { UnitOfMeasure } from '@/types/unit';

export type StockStatus = 'in_stock' | 'limited_stock' | 'out_of_stock';

export interface Material {
  id: string;
  name: string;
  categoryId: CategoryId;
  supplierId: string;
  /** No product photography exists yet — omitted in mock data; MaterialCard falls back to a category-tinted placeholder. */
  imageUrl?: string;
  pricePerUnit: number;
  unit: UnitOfMeasure;
  stockStatus: StockStatus;
  minOrderQuantity: number;
  quantityStep: number;
  estimatedDeliveryDays: string;
  description?: string;
}
