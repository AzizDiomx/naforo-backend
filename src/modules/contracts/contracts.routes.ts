import { Router } from 'express';
import * as contractsController from './contracts.controller';
import { validate } from '@/shared/middlewares/validate.middleware';
import { authenticate } from '@/shared/middlewares/auth.middleware';
import { authorize } from '@/shared/middlewares/rbac.middleware';
import { requireTenant } from '@/shared/middlewares/tenant.middleware';
import { auditLog } from '@/shared/middlewares/audit.middleware';
import {
  CreateContractSchema,
  UpdateContractSchema,
  TerminateContractSchema,
  SendOtpSchema,
  SignOtpSchema,
} from './contracts.schema';

import { checkSubscription, requirePlanFeature } from '@/shared/middlewares/subscription.middleware';

const router = Router();

router.use(authenticate);
router.use(requireTenant);
router.use(checkSubscription);

router.get(
  '/', 
  authorize('admin', 'manager', 'owner'), 
  contractsController.getAllContracts
);

router.get(
  '/expiring-soon', 
  authorize('admin', 'manager', 'owner'), 
  contractsController.getExpiringSoon
);

router.get(
  '/stats', 
  authorize('admin', 'manager', 'owner'), 
  contractsController.getStats
);

router.get(
  '/:id', 
  authorize('admin', 'manager', 'owner', 'tenant'), 
  contractsController.getContractById
);

router.post(
  '/', 
  authorize('admin', 'manager', 'owner'), 
  validate(CreateContractSchema), 
  auditLog('CREATE_CONTRACT', 'Contract'),
  contractsController.createContract
);

router.put(
  '/:id', 
  authorize('admin', 'manager', 'owner'), 
  validate(UpdateContractSchema), 
  auditLog('UPDATE_CONTRACT', 'Contract'),
  contractsController.updateContract
);

router.post(
  '/:id/terminate', 
  authorize('admin', 'manager'), 
  validate(TerminateContractSchema), 
  auditLog('TERMINATE_CONTRACT', 'Contract'),
  contractsController.terminateContract
);

router.get(
  '/:id/pdf',
  authorize('admin', 'manager', 'owner', 'tenant'),
  contractsController.generatePdf
);

router.post(
  '/:id/send-otp',
  authorize('admin', 'manager', 'owner'),
  requirePlanFeature('e_signature', 'Signature électronique OTP des baux'),
  validate(SendOtpSchema),
  auditLog('SEND_SIGNATURE_OTP', 'Contract'),
  contractsController.sendSignatureOtp
);

router.post(
  '/:id/sign-otp',
  authorize('admin', 'manager', 'owner', 'tenant'),
  requirePlanFeature('e_signature', 'Signature électronique OTP des baux'),
  validate(SignOtpSchema),
  auditLog('SIGN_CONTRACT_OTP', 'Contract'),
  contractsController.signContractWithOtp
);

export default router;
