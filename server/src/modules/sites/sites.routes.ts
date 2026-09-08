import { Router } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import { validate } from '../../middleware/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import * as sitesController from './sites.controller';
import { createSiteSchema } from './sites.schemas';

export const sitesRouter = Router();

sitesRouter.get('/', requireAuth, requireRole('contractor'), asyncHandler(sitesController.list));
sitesRouter.post(
  '/',
  requireAuth,
  requireRole('contractor'),
  validate({ body: createSiteSchema }),
  asyncHandler(sitesController.create),
);
