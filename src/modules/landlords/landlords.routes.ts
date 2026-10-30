import { Router } from 'express';
import * as landlordsController from './landlords.controller';
import { validate } from '@/shared/middlewares/validate.middleware';
import { authenticate } from '@/shared/middlewares/auth.middleware';
import { authorize } from '@/shared/middlewares/rbac.middleware';
import { requireTenant } from '@/shared/middlewares/tenant.middleware';
import { auditLog } from '@/shared/middlewares/audit.middleware';
import { checkSubscription, requirePlanFeature } from '@/shared/middlewares/subscription.middleware';
import { CreateLandlordSchema, UpdateLandlordSchema, AssignPropertiesSchema } from './landlords.schema';

const router = Router();

router.use(authenticate);
router.use(requireTenant);
router.use(checkSubscription);
router.use(requirePlanFeature('landlords_crg', 'Gestion des Bailleurs & Mandats (CRG)'));

router.get(
  '/',
  authorize('admin', 'manager', 'owner', 'accountant'),
  landlordsController.getAllLandlords
);

router.post(
  '/',
  authorize('admin', 'owner'),
  validate(CreateLandlordSchema),
  auditLog('CREATE_LANDLORD', 'Landlord'),
  landlordsController.createLandlord
);

router.get(
  '/:id',
  authorize('admin', 'manager', 'owner', 'accountant'),
  landlordsController.getLandlordById
);

router.put(
  '/:id',
  authorize('admin', 'owner'),
  validate(UpdateLandlordSchema),
  auditLog('UPDATE_LANDLORD', 'Landlord'),
  landlordsController.updateLandlord
);

router.put(
  '/:id/properties',
  authorize('admin', 'owner'),
  validate(AssignPropertiesSchema),
  auditLog('ASSIGN_LANDLORD_PROPERTIES', 'Landlord'),
  landlordsController.assignProperties
);

router.delete(
  '/:id',
  authorize('admin', 'owner'),
  auditLog('DELETE_LANDLORD', 'Landlord'),
  landlordsController.deleteLandlord
);

export default router;
