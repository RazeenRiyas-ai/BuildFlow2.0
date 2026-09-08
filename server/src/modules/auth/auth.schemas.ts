import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  companyName: z.string().trim().max(200).optional(),
  phone: z.string().trim().min(6).max(20),
  password: z.string().min(8).max(200),
});

export const loginSchema = z.object({
  phone: z.string().trim().min(6).max(20),
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});
