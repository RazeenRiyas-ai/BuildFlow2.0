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
  driverName: z.string().trim().min(1).max(200),
  driverPhone: z.string().trim().max(20).optional(),
  note: z.string().trim().max(500).optional(),
});

export const deliveryUpdateSchema = z.object({
  note: z.string().trim().min(1).max(500),
});
