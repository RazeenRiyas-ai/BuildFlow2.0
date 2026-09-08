import { Router } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import * as categoriesController from './categories.controller';

export const categoriesRouter = Router();

categoriesRouter.get('/', asyncHandler(categoriesController.list));
categoriesRouter.get('/:id', asyncHandler(categoriesController.getById));
