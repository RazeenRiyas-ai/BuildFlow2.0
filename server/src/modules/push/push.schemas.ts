import { z } from 'zod';

export const registerPushTokenSchema = z.object({
  expoPushToken: z.string().min(1),
  platform: z.enum(['ios', 'android', 'web']),
});

export const unregisterPushTokenSchema = z.object({
  expoPushToken: z.string().min(1),
});
