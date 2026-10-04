import { Router } from 'express';
import * as tenantProfilesController from './tenant-profiles.controller';
import { validate } from '@/shared/middlewares/validate.middleware';
import { authenticate } from '@/shared/middlewares/auth.middleware';
import { authorize } from '@/shared/middlewares/rbac.middleware';
import { requireTenant } from '@/shared/middlewares/tenant.middleware';
import { uploadSingle } from '@/shared/middlewares/upload.middleware';
import { auditLog } from '@/shared/middlewares/audit.middleware';
import { CreateTenantProfileSchema, UpdateTenantProfileSchema } from './tenant-profiles.schema';

import { checkSubscription } from '@/shared/middlewares/subscription.middleware';

const router = Router();

router.use(authenticate);
router.use(requireTenant);
router.use(checkSubscription);

router.get(
  '/', 
  authorize('admin', 'manager', 'owner'), 
  tenantProfilesController.getAllTenantProfiles
);

router.post(
  '/', 
  authorize('admin', 'manager', 'owner'), 
  validate(CreateTenantProfileSchema), 
  auditLog('CREATE_TENANT_PROFILE', 'TenantProfile'),
  tenantProfilesController.createTenantProfile
);

router.get(
  '/:id', 
  authorize('admin', 'manager', 'owner'), 
  tenantProfilesController.getTenantProfileById
);

router.put(
  '/:id', 
  authorize('admin', 'manager', 'owner'), 
  validate(UpdateTenantProfileSchema), 
  auditLog('UPDATE_TENANT_PROFILE', 'TenantProfile'),
  tenantProfilesController.updateTenantProfile
);

router.post(
  '/:id/avatar', 
  authorize('admin', 'manager', 'owner'), 
  uploadSingle('avatar'), 
  auditLog('UPLOAD_TENANT_AVATAR', 'TenantProfile'),
  tenantProfilesController.uploadAvatar
);

router.get(
  '/:id/history', 
  authorize('admin', 'manager', 'owner', 'tenant'), // ownership check can be added if role is tenant
  tenantProfilesController.getHistory
);

router.delete(
  '/:id', 
  authorize('admin'), 
  auditLog('DELETE_TENANT_PROFILE', 'TenantProfile'),
  tenantProfilesController.deleteTenantProfile
);

export default router;
