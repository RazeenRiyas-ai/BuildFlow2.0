import { z } from 'zod';

export const createOrderSchema = z.object({
  materialId: z.string().uuid(),
  siteId: z.string().uuid(),
  quantity: z.number().positive(),
  note: z.string().trim().max(500).optional(),
});
