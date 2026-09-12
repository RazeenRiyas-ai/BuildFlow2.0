import { Router } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import { validate } from '../../middleware/validate';
import { requireAuth, requireRole } from '../../middleware/auth';
import { uuidParamSchema } from '../../utils/common-schemas';
import * as suppliersController from './suppliers.controller';
import { createSupplierSchema, listSuppliersQuerySchema, updateSupplierSchema } from './suppliers.schemas';

export const suppliersRouter = Router();

suppliersRouter.get(
  '/',
  requireAuth,
  requireRole('hq_staff', 'hq_admin'),
  validate({ query: listSuppliersQuerySchema }),
  asyncHandler(suppliersController.list),
);
// Any authenticated role, not just HQ — a contractor viewing a material's detail page needs to
// resolve which supplier fulfills it (see src/app/material/[materialId]/index.tsx). The
// privacy-sensitive field (phone) is withheld at this route regardless of role — see
// suppliers.service.ts's PublicSupplierRow — rather than gating the whole route to HQ, which would
// break that existing contractor-facing screen.
suppliersRouter.get('/:id', requireAuth, validate({ params: uuidParamSchema }), asyncHandler(suppliersController.getById));

suppliersRouter.post(
  '/',
  requireAuth,
  requireRole('hq_staff', 'hq_admin'),
  validate({ body: createSupplierSchema }),
  asyncHandler(suppliersController.create),
);
suppliersRouter.patch(
  '/:id',
  requireAuth,
  requireRole('hq_staff', 'hq_admin'),
  validate({ params: uuidParamSchema, body: updateSupplierSchema }),
  asyncHandler(suppliersController.update),
);
