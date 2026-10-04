import { Router } from 'express';
import * as orgsController from './organizations.controller';
import { validate } from '@/shared/middlewares/validate.middleware';
import { authenticate } from '@/shared/middlewares/auth.middleware';
import { authorize } from '@/shared/middlewares/rbac.middleware';
import { auditLog } from '@/shared/middlewares/audit.middleware';
import { CreateOrganizationSchema, UpdateOrganizationSchema } from './organizations.schema';

const router = Router();

router.use(authenticate);

// List orgs: Only Platform Super Admin
router.get(
  '/', 
  authorize('super_admin'), 
  orgsController.getAllOrganizations
);

// Create orgs: Only Platform Super Admin
router.post(
  '/', 
  authorize('super_admin'), 
  validate(CreateOrganizationSchema), 
  auditLog('CREATE_ORGANIZATION', 'Organization'),
  orgsController.createOrganization
);

// Get specific org info: Super Admin OR organization users
router.get(
  '/:id', 
  orgsController.getOrganizationById
);

// Update org: Super Admin OR Organization Admin/Owner
router.put(
  '/:id', 
  authorize('super_admin', 'admin', 'owner'), 
  validate(UpdateOrganizationSchema), 
  auditLog('UPDATE_ORGANIZATION', 'Organization'),
  orgsController.updateOrganization
);

// Get org database stats: Super Admin OR Organization staff members
router.get(
  '/:id/stats', 
  authorize('super_admin', 'admin', 'manager', 'accountant', 'owner'), 
  orgsController.getStats
);

// Request Account Deletion (30-day grace period soft delete)
router.post(
  '/:id/request-deletion',
  authorize('super_admin', 'admin', 'owner'),
  auditLog('REQUEST_ACCOUNT_DELETION', 'Organization'),
  orgsController.requestAccountDeletion
);

// Cancel Account Deletion (Restore account)
router.post(
  '/:id/cancel-deletion',
  authorize('super_admin', 'admin', 'owner'),
  auditLog('CANCEL_ACCOUNT_DELETION', 'Organization'),
  orgsController.cancelAccountDeletion
);

export default router;
