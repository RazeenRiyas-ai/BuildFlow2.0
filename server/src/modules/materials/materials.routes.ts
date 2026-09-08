import { Router } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import { validate } from '../../middleware/validate';
import { uuidParamSchema } from '../../utils/common-schemas';
import * as materialsController from './materials.controller';
import { listMaterialsQuerySchema, searchMaterialsQuerySchema } from './materials.schemas';

export const materialsRouter = Router();

materialsRouter.get('/search', validate({ query: searchMaterialsQuerySchema }), asyncHandler(materialsController.search));
materialsRouter.get('/', validate({ query: listMaterialsQuerySchema }), asyncHandler(materialsController.list));
materialsRouter.get('/:id', validate({ params: uuidParamSchema }), asyncHandler(materialsController.getById));

// Mounted separately at the app level as GET /categories/:id/materials (see app.ts).
export const categoryMaterialsRouter = Router();
categoryMaterialsRouter.get('/:id/materials', asyncHandler(materialsController.listByCategory));
