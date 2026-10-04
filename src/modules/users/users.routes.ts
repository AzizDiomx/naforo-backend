import { Router } from 'express';
import * as usersController from './users.controller';
import { validate } from '@/shared/middlewares/validate.middleware';
import { authenticate } from '@/shared/middlewares/auth.middleware';
import { authorize } from '@/shared/middlewares/rbac.middleware';
import { requireTenant } from '@/shared/middlewares/tenant.middleware';
import { auditLog } from '@/shared/middlewares/audit.middleware';
import { CreateUserSchema, UpdateUserSchema, UpdateFCMTokenSchema } from './users.schema';

const router = Router();

// Apply authentication and tenant isolation to all user routes
router.use(authenticate);
router.use(requireTenant);

router.get(
  '/', 
  authorize('admin', 'manager'), 
  usersController.getAllUsers
);

router.post(
  '/', 
  authorize('admin'), 
  validate(CreateUserSchema), 
  auditLog('CREATE_USER', 'User'),
  usersController.createUser
);

router.put(
  '/fcm-token', 
  validate(UpdateFCMTokenSchema), 
  usersController.updateFCMToken
);

router.get(
  '/:id', 
  authorize('admin', 'manager'), 
  usersController.getUserById
);

router.put(
  '/:id', 
  authorize('admin'), 
  validate(UpdateUserSchema), 
  auditLog('UPDATE_USER', 'User'),
  usersController.updateUser
);

router.delete(
  '/:id', 
  authorize('admin'), 
  auditLog('DELETE_USER', 'User'),
  usersController.deleteUser
);

export default router;
