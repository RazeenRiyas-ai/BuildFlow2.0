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
import * as materialsAdminController from '../materials/materials.admin.controller';
import {
  listHqMaterialsQuerySchema,
  createMaterialSchema,
  updateMaterialSchema,
  reorderPhotosSchema,
  materialPhotoIdParamsSchema,
} from '../materials/materials.schemas';

export const hqRouter = Router();

hqRouter.use(requireAuth, requireRole('hq_staff', 'hq_admin'));

hqRouter.get('/orders', validate({ query: listHqOrdersQuerySchema }), asyncHandler(hqController.list));
hqRouter.get('/orders/:id', validate({ params: uuidParamSchema }), asyncHandler(hqController.getById));
hqRouter.patch('/orders/:id/status', validate({ params: uuidParamSchema, body: updateStatusSchema }), asyncHandler(hqController.updateStatus));
hqRouter.post('/orders/:id/supplier-contact', validate({ params: uuidParamSchema, body: supplierContactSchema }), asyncHandler(hqController.supplierContact));
hqRouter.post('/orders/:id/assign-supplier', validate({ params: uuidParamSchema, body: assignSupplierSchema }), asyncHandler(hqController.assignSupplier));
hqRouter.post('/orders/:id/assign-driver', validate({ params: uuidParamSchema, body: assignDriverSchema }), asyncHandler(hqController.assignDriver));
hqRouter.post('/orders/:id/delivery-update', validate({ params: uuidParamSchema, body: deliveryUpdateSchema }), asyncHandler(hqController.deliveryUpdate));

// --- Material management (Phase 3.1) ---
hqRouter.get('/materials', validate({ query: listHqMaterialsQuerySchema }), asyncHandler(materialsAdminController.list));
hqRouter.get('/materials/:id', validate({ params: uuidParamSchema }), asyncHandler(materialsAdminController.getById));
hqRouter.post('/materials', validate({ body: createMaterialSchema }), asyncHandler(materialsAdminController.create));
hqRouter.patch('/materials/:id', validate({ params: uuidParamSchema, body: updateMaterialSchema }), asyncHandler(materialsAdminController.update));

// --- Material photos (Phase 3.1) ---
hqRouter.get('/materials/:id/photos', validate({ params: uuidParamSchema }), asyncHandler(materialsAdminController.listPhotos));
hqRouter.post(
  '/materials/:id/photos',
  validate({ params: uuidParamSchema }),
  materialsAdminController.uploadPhotoMiddleware,
  asyncHandler(materialsAdminController.uploadPhoto),
);
hqRouter.patch(
  '/materials/:id/photos/order',
  validate({ params: uuidParamSchema, body: reorderPhotosSchema }),
  asyncHandler(materialsAdminController.reorderPhotos),
);
hqRouter.post(
  '/materials/:id/photos/:photoId/primary',
  validate({ params: materialPhotoIdParamsSchema }),
  asyncHandler(materialsAdminController.setPrimaryPhoto),
);
hqRouter.put(
  '/materials/:id/photos/:photoId',
  validate({ params: materialPhotoIdParamsSchema }),
  materialsAdminController.uploadPhotoMiddleware,
  asyncHandler(materialsAdminController.replacePhoto),
);
hqRouter.delete(
  '/materials/:id/photos/:photoId',
  validate({ params: materialPhotoIdParamsSchema }),
  asyncHandler(materialsAdminController.deletePhoto),
);
