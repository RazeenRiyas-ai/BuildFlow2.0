import { Router } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import { requireAuth, requireRole } from '../../middleware/auth';
import * as contractorsController from './contractors.controller';

export const contractorsRouter = Router();

contractorsRouter.get('/me', requireAuth, requireRole('contractor'), asyncHandler(contractorsController.me));
