import { z } from 'zod';

export const orderStatusEnum = z.enum([
  'requested',
  'supplier_contacted',
  'supplier_confirmed',
  'supplier_rejected',
  'driver_assigned',
  'out_for_delivery',
  'delivered',
  'cancelled',
]);

export const listHqOrdersQuerySchema = z.object({
  status: orderStatusEnum.optional(),
});

export const updateStatusSchema = z.object({
  status: orderStatusEnum,
  note: z.string().trim().max(500).optional(),
});

export const supplierContactSchema = z.object({
  supplierId: z.string().uuid(),
  contactMethod: z.string().trim().min(1).max(50),
  outcome: z.string().trim().min(1).max(50),
  note: z.string().trim().max(500).optional(),
});

export const assignSupplierSchema = z.object({
  supplierId: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
});

export const assignDriverSchema = z.object({
  driverId: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
});

export const deliveryUpdateSchema = z.object({
  note: z.string().trim().min(1).max(500),
});

export const setDeliveryChargeSchema = z.object({
  // NUMERIC(10,2), matching order_items.price_per_unit's own precision: nonnegative (0 is a valid,
  // explicit "free delivery" answer — see hq.service.ts's setDeliveryCharge for why this must stay
  // distinct from NULL/"not yet set"), and at most 2 decimal places so what HQ enters is exactly
  // what gets stored, with no silent rounding.
  amount: z.coerce
    .number()
    .nonnegative('Delivery charge cannot be negative')
    .finite()
    // Math.round(n * 100) is ALWAYS an integer by definition, so checking Number.isInteger on it
    // would be a no-op — the actual check is whether rounding to cents changed the value at all.
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-9, 'Delivery charge can have at most 2 decimal places'),
  note: z.string().trim().max(500).optional(),
});
