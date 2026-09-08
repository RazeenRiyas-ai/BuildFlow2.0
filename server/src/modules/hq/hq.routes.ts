import { Router } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import { validate } from '../../middleware/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import { uuidParamSchema } from '../../utils/common-schemas';
import * as hqController from './hq.controller';
import { listHqOrdersQuerySchema } from './hq.schemas';
import { updateStatusSchema } from './hq.schemas';
import { supplierContactSchema } from './hq.schemas';
import { assignSupplierSchema } from './hq.schemas';
import { assignDriverSchema } from './hq.schemas';
import { deliveryUpdateSchema } from './hq.schemas';

export const hqRouter = Router();

hqRouter.use(requireAuth, requireRole('hq_staff', 'hq_admin'));

hqRouter.get('/orders', validate({ query: listHqOrdersQuerySchema }), asyncHandler(hqController.list));
hqRouter.get('/orders/:id', validate({ params: uuidParamSchema }), asyncHandler(hqController.getById));
hqRouter.patch('/orders/:id/status', validate({ params: uuidParamSchema, body: updateStatusSchema }), asyncHandler(hqController.updateStatus));
hqRouter.post('/orders/:id/supplier-contact', validate({ params: uuidParamSchema, body: supplierContactSchema }), asyncHandler(hqController.supplierContact));
hqRouter.post('/orders/:id/assign-supplier', validate({ params: uuidParamSchema, body: assignSupplierSchema }), asyncHandler(hqController.assignSupplier));
hqRouter.post('/orders/:id/assign-driver', validate({ params: uuidParamSchema, body: assignDriverSchema }), asyncHandler(hqController.assignDriver));
hqRouter.post('/orders/:id/delivery-update', validate({ params: uuidParamSchema, body: deliveryUpdateSchema }), asyncHandler(hqController.deliveryUpdate));
