import { Router } from 'express';
import * as propertiesController from './properties.controller';
import { validate } from '@/shared/middlewares/validate.middleware';
import { authenticate } from '@/shared/middlewares/auth.middleware';
import { authorize } from '@/shared/middlewares/rbac.middleware';
import { requireTenant } from '@/shared/middlewares/tenant.middleware';
import { uploadMultiple } from '@/shared/middlewares/upload.middleware';
import { auditLog } from '@/shared/middlewares/audit.middleware';
import {
  CreatePropertySchema,
  UpdatePropertySchema,
  UpdatePropertyStatusSchema,
} from './properties.schema';

import { checkSubscription } from '@/shared/middlewares/subscription.middleware';

const router = Router();

router.use(authenticate);
router.use(requireTenant);
router.use(checkSubscription);

router.get(
  '/', 
  authorize('admin', 'manager', 'owner'), 
  propertiesController.getAllProperties
);

router.get(
  '/available', 
  authorize('admin', 'manager', 'owner'), 
  propertiesController.getAvailableProperties
);

router.get(
  '/stats', 
  authorize('admin', 'manager', 'owner'), 
  propertiesController.getStats
);

router.get(
  '/:id', 
  authorize('admin', 'manager', 'owner', 'tenant'), 
  propertiesController.getPropertyById
);

router.post(
  '/', 
  authorize('admin', 'manager', 'owner'), 
  validate(CreatePropertySchema), 
  auditLog('CREATE_PROPERTY', 'Property'),
  propertiesController.createProperty
);

router.put(
  '/:id', 
  authorize('admin', 'manager', 'owner'), 
  validate(UpdatePropertySchema), 
  auditLog('UPDATE_PROPERTY', 'Property'),
  propertiesController.updateProperty
);

router.patch(
  '/:id/status', 
  authorize('admin', 'manager'), 
  validate(UpdatePropertyStatusSchema), 
  auditLog('UPDATE_PROPERTY_STATUS', 'Property'),
  propertiesController.updatePropertyStatus
);

router.post(
  '/:id/photos', 
  authorize('admin', 'manager'), 
  uploadMultiple('photos', 10), 
  auditLog('UPLOAD_PROPERTY_PHOTOS', 'Property'),
  propertiesController.uploadPhotos
);

router.delete(
  '/:id', 
  authorize('admin'), 
  auditLog('DELETE_PROPERTY', 'Property'),
  propertiesController.deleteProperty
);

export default router;
