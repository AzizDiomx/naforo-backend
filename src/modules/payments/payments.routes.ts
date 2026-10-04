import { Router } from 'express';
import * as paymentsController from './payments.controller';
import { validate } from '@/shared/middlewares/validate.middleware';
import { authenticate } from '@/shared/middlewares/auth.middleware';
import { authorize } from '@/shared/middlewares/rbac.middleware';
import { requireTenant } from '@/shared/middlewares/tenant.middleware';
import { uploadSingle } from '@/shared/middlewares/upload.middleware';
import { auditLog } from '@/shared/middlewares/audit.middleware';
import { DeclarePaymentSchema, ValidatePaymentSchema } from './payments.schema';

import { checkSubscription } from '@/shared/middlewares/subscription.middleware';

const router = Router();

router.use(authenticate);
router.use(requireTenant);
router.use(checkSubscription);

router.get(
  '/', 
  authorize('admin', 'manager', 'accountant', 'owner'), 
  paymentsController.getAllPayments
);

router.get(
  '/pending', 
  authorize('admin', 'manager', 'accountant', 'owner'), 
  paymentsController.getPendingPayments
);

router.get(
  '/stats', 
  authorize('admin', 'manager', 'accountant', 'owner'), 
  paymentsController.getStats
);

router.get(
  '/:id', 
  authorize('admin', 'manager', 'accountant', 'owner', 'tenant'), 
  paymentsController.getPaymentById
);

router.post(
  '/', 
  authorize('tenant', 'admin', 'manager', 'owner'), 
  validate(DeclarePaymentSchema), 
  auditLog('DECLARE_PAYMENT', 'Payment'),
  paymentsController.declarePayment
);

router.post(
  '/:id/proof', 
  authorize('tenant', 'admin', 'manager', 'owner'), 
  uploadSingle('proof'), 
  auditLog('UPLOAD_PAYMENT_PROOF', 'Payment'),
  paymentsController.uploadProof
);

router.put(
  '/:id/validate', 
  authorize('admin', 'manager', 'accountant', 'owner'), 
  validate(ValidatePaymentSchema), 
  auditLog('VALIDATE_PAYMENT', 'Payment'),
  paymentsController.validatePayment
);

export default router;
