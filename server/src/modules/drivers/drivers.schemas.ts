import { z } from 'zod';

export const listDriversQuerySchema = z.object({
  includeInactive: z.enum(['true', 'false']).optional(),
});

export const createDriverSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(20).optional(),
});

export const updateDriverSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    phone: z.string().trim().max(20).nullable(),
    isActive: z.coerce.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'At least one field must be provided' });
