import { z } from 'zod';

export const listMaterialsQuerySchema = z.object({
  featured: z
    .enum(['true', 'false'])
    .optional(),
});

export const searchMaterialsQuerySchema = z.object({
  q: z.string().trim().default(''),
});

// ---------------------------------------------------------------------------
// HQ admin — material CRUD
// ---------------------------------------------------------------------------

const stockStatusEnum = z.enum(['in_stock', 'limited_stock', 'out_of_stock']);
// Must stay in sync with the frontend's UnitOfMeasure (src/types/unit.ts) — the contractor app's
// pluralizeUnit() only knows how to render these exact values, so accepting anything else here
// would let HQ create a material the contractor UI can't display correctly (see the "10
// undefineds" bug this closes: a free-text unit like "Bag" doesn't match pluralizeUnit's lookup).
const unitOfMeasureEnum = z.enum(['bag', 'tonne', 'kg', 'piece', 'sqft', 'box', 'unit', 'litre']);

export const listHqMaterialsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  categoryId: z.string().trim().min(1).max(100).optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
});

export const createMaterialSchema = z.object({
  name: z.string().trim().min(1).max(200),
  categoryId: z.string().trim().min(1).max(100),
  supplierId: z.string().uuid(),
  unit: unitOfMeasureEnum,
  pricePerUnit: z.coerce.number().positive().max(10_000_000),
  stockStatus: stockStatusEnum.default('in_stock'),
  minOrderQuantity: z.coerce.number().positive().max(1_000_000),
  quantityStep: z.coerce.number().positive().max(1_000_000),
  estimatedDeliveryDays: z.string().trim().min(1).max(50),
  description: z.string().trim().max(4000).optional(),
  isFeatured: z.coerce.boolean().default(false),
  isActive: z.coerce.boolean().default(true),
});

export const updateMaterialSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    categoryId: z.string().trim().min(1).max(100),
    supplierId: z.string().uuid(),
    unit: unitOfMeasureEnum,
    pricePerUnit: z.coerce.number().positive().max(10_000_000),
    stockStatus: stockStatusEnum,
    minOrderQuantity: z.coerce.number().positive().max(1_000_000),
    quantityStep: z.coerce.number().positive().max(1_000_000),
    estimatedDeliveryDays: z.string().trim().min(1).max(50),
    description: z.string().trim().max(4000).nullable(),
    isFeatured: z.coerce.boolean(),
    isActive: z.coerce.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'At least one field must be provided' });

// ---------------------------------------------------------------------------
// HQ admin — photos
// ---------------------------------------------------------------------------

/** multer parses multipart fields as strings; `isPrimary` arrives (if sent at all) as the literal
 * text "true"/"false" on req.body alongside req.file, not JSON — validated separately from the
 * material body schemas above. */
export const uploadPhotoFieldsSchema = z.object({
  isPrimary: z.enum(['true', 'false']).optional(),
});

export const reorderPhotosSchema = z.object({
  photoIds: z.array(z.string().uuid()).min(1).max(50),
});

export const materialPhotoIdParamsSchema = z.object({
  id: z.string().uuid(),
  photoId: z.string().uuid(),
});
