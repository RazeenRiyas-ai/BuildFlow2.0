import { Router } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import { validate } from '../../middleware/validate';
import { authRateLimit, sessionRateLimit } from '../../middleware/rateLimit';
import * as authController from './auth.controller';
import { registerSchema, loginSchema, refreshSchema, logoutSchema } from './auth.schemas';

export const authRouter = Router();

authRouter.post(
  '/register',
  authRateLimit,
  validate({ body: registerSchema }),
  asyncHandler(authController.register),
);

authRouter.post('/login', authRateLimit, validate({ body: loginSchema }), asyncHandler(authController.login));

authRouter.post(
  '/refresh',
  sessionRateLimit,
  validate({ body: refreshSchema }),
  asyncHandler(authController.refresh),
);

authRouter.post(
  '/logout',
  sessionRateLimit,
  validate({ body: logoutSchema }),
  asyncHandler(authController.logout),
);
