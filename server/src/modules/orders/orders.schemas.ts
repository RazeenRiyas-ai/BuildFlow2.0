import { z } from 'zod';

const orderItemSchema = z.object({
  materialId: z.string().uuid(),
  quantity: z.number().positive(),
});

export const createOrderSchema = z.object({
  siteId: z.string().uuid(),
  // A one-item order is the natural degenerate case (array of length 1) — never a distinct code
  // path. 50 is a generous, purely defensive upper bound (basic input hygiene, matching e.g.
  // `note`'s own max(500) below) — no real cart is expected to approach it.
  items: z.array(orderItemSchema).min(1).max(50),
  note: z.string().trim().max(500).optional(),
});
