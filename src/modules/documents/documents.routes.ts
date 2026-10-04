import { Router } from 'express';
import * as documentsController from './documents.controller';
import { authenticate } from '@/shared/middlewares/auth.middleware';
import { authorize } from '@/shared/middlewares/rbac.middleware';
import { requireTenant } from '@/shared/middlewares/tenant.middleware';
import { uploadSingle } from '@/shared/middlewares/upload.middleware';
import { auditLog } from '@/shared/middlewares/audit.middleware';

const router = Router();

router.use(authenticate);
router.use(requireTenant);

router.get(
  '/', 
  authorize('admin', 'manager', 'owner', 'tenant'), 
  documentsController.getAllDocuments
);

import { requirePlanFeature } from '@/shared/middlewares/subscription.middleware';

router.post(
  '/upload', 
  authorize('admin', 'manager', 'owner'), 
  requirePlanFeature('ged_vault', 'Coffre-fort GED & Téléversement de Documents'),
  uploadSingle('document'), 
  auditLog('UPLOAD_DOCUMENT', 'Document'),
  documentsController.uploadDocument
);

router.delete(
  '/:id', 
  authorize('admin', 'manager', 'owner'), 
  auditLog('DELETE_DOCUMENT', 'Document'),
  documentsController.deleteDocument
);

export default router;
