import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/async-handler';
import { validate } from '../../middleware/validate';
import { optionalAuth } from '../../middleware/auth';
import { uuidParamSchema } from '../../utils/common-schemas';
import * as materialsController from './materials.controller';
import { listMaterialsQuerySchema, searchMaterialsQuerySchema } from './materials.schemas';

const materialPhotoParamsSchema = z.object({ materialId: z.string().uuid(), photoId: z.string().uuid() });

export const materialsRouter = Router();

materialsRouter.get('/search', validate({ query: searchMaterialsQuerySchema }), asyncHandler(materialsController.search));
materialsRouter.get('/', validate({ query: listMaterialsQuerySchema }), asyncHandler(materialsController.list));
materialsRouter.get(
  '/:materialId/photos/:photoId/file',
  optionalAuth,
  validate({ params: materialPhotoParamsSchema }),
  asyncHandler(materialsController.getPhotoFile),
);
materialsRouter.get('/:id', validate({ params: uuidParamSchema }), asyncHandler(materialsController.getById));

// Mounted separately at the app level as GET /categories/:id/materials (see app.ts).
export const categoryMaterialsRouter = Router();
categoryMaterialsRouter.get('/:id/materials', asyncHandler(materialsController.listByCategory));
