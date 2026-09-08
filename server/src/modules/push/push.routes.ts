import { Router } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import * as pushController from './push.controller';
import { registerPushTokenSchema, unregisterPushTokenSchema } from './push.schemas';

export const pushRouter = Router();

pushRouter.use(requireAuth);

pushRouter.post('/register', validate({ body: registerPushTokenSchema }), asyncHandler(pushController.register));
pushRouter.post('/unregister', validate({ body: unregisterPushTokenSchema }), asyncHandler(pushController.unregister));
