import { Router } from 'express';
import * as receiptsController from './receipts.controller';
import { authenticate } from '@/shared/middlewares/auth.middleware';
import { authorize } from '@/shared/middlewares/rbac.middleware';
import { requireTenant } from '@/shared/middlewares/tenant.middleware';

const router = Router();

// Public route: Verification of paper receipts by scanning QR Code (needs no auth headers)
router.get(
  '/verify/:receiptNumber', 
  receiptsController.verifyReceipt
);

// Authenticated routes below
router.use(authenticate);
router.use(requireTenant);

router.get(
  '/', 
  authorize('admin', 'manager', 'accountant', 'owner'), 
  receiptsController.getAllReceipts
);

router.get(
  '/:id', 
  authorize('admin', 'manager', 'accountant', 'owner', 'tenant'), 
  receiptsController.getReceiptById
);

router.get(
  '/:id/download', 
  authorize('admin', 'manager', 'accountant', 'owner', 'tenant'), 
  receiptsController.downloadReceipt
);

export default router;
