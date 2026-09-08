import { z } from 'zod';

export const createSiteSchema = z.object({
  label: z.string().trim().min(1).max(200),
  address: z.string().trim().min(1).max(500),
  notes: z.string().trim().max(500).optional(),
});
