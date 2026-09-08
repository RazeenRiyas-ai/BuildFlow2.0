import { z } from 'zod';

export const listMaterialsQuerySchema = z.object({
  featured: z
    .enum(['true', 'false'])
    .optional(),
});

export const searchMaterialsQuerySchema = z.object({
  q: z.string().trim().default(''),
});
