import { CategoryId } from '@/types/category';
import { UnitOfMeasure } from '@/types/unit';

export type StockStatus = 'in_stock' | 'limited_stock' | 'out_of_stock';

export interface MaterialPhoto {
  id: string;
  /** Server-relative path (e.g. `/materials/<id>/photos/<photoId>/file`) — combine with the API
   * base URL (see services/api-client.ts's buildApiUrl) before handing to an <Image>. */
  url: string;
  isPrimary: boolean;
  displayOrder: number;
  width: number;
  height: number;
  createdAt: string;
}

export interface Material {
  id: string;
  name: string;
  categoryId: CategoryId;
  supplierId: string;
  /** Primary photo URL when the material has one uploaded — falls back to undefined (MaterialCard
   * then shows a category-tinted placeholder) when no photo has been uploaded/marked primary. */
  imageUrl?: string;
  pricePerUnit: number;
  unit: UnitOfMeasure;
  stockStatus: StockStatus;
  minOrderQuantity: number;
  quantityStep: number;
  estimatedDeliveryDays: string;
  description?: string;
  /** Only present on the single-material detail response (GET /materials/:id) — list/search/category
   * responses carry just `imageUrl` (the primary photo) to keep those payloads light. */
  photos?: MaterialPhoto[];
}

// ---------------------------------------------------------------------------
// HQ admin — material management (Phase 3.1)
// ---------------------------------------------------------------------------

/** The shape HQ's material endpoints (/hq/materials/*) return: the public Material fields plus
 * admin-only visibility into feature/active flags and the full photo set. */
export interface HqMaterial extends Material {
  isFeatured: boolean;
  isActive: boolean;
  photos: MaterialPhoto[];
}

export interface MaterialFormInput {
  name: string;
  categoryId: CategoryId;
  supplierId: string;
  unit: UnitOfMeasure;
  pricePerUnit: number;
  stockStatus: StockStatus;
  minOrderQuantity: number;
  quantityStep: number;
  estimatedDeliveryDays: string;
  description?: string;
  isFeatured: boolean;
  isActive: boolean;
}
