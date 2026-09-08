import { Router } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import { validate } from '../../middleware/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import { uuidParamSchema } from '../../utils/common-schemas';
import * as ordersController from './orders.controller';
import { createOrderSchema } from './orders.schemas';

export const ordersRouter = Router();

ordersRouter.use(requireAuth, requireRole('contractor'));

ordersRouter.post('/', validate({ body: createOrderSchema }), asyncHandler(ordersController.create));
ordersRouter.get('/', asyncHandler(ordersController.list));
ordersRouter.get('/:id', validate({ params: uuidParamSchema }), asyncHandler(ordersController.getById));
ordersRouter.patch('/:id/cancel', validate({ params: uuidParamSchema }), asyncHandler(ordersController.cancel));
