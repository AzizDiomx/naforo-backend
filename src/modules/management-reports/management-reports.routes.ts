import { Router } from 'express';
import * as reportsController from './management-reports.controller';
import { validate } from '@/shared/middlewares/validate.middleware';
import { authenticate } from '@/shared/middlewares/auth.middleware';
import { authorize } from '@/shared/middlewares/rbac.middleware';
import { requireTenant } from '@/shared/middlewares/tenant.middleware';
import { auditLog } from '@/shared/middlewares/audit.middleware';
import { checkSubscription, requirePlanFeature } from '@/shared/middlewares/subscription.middleware';
import { GenerateReportSchema, GenerateAllReportsSchema, UpdateReportStatusSchema } from './management-reports.schema';

const router = Router();

router.use(authenticate);
router.use(requireTenant);
router.use(checkSubscription);
router.use(requirePlanFeature('landlords_crg', 'Comptes-Rendus de Gestion (CRG)'));

router.get(
  '/',
  authorize('admin', 'manager', 'owner', 'accountant'),
  reportsController.getAllReports
);

router.post(
  '/generate',
  authorize('admin', 'owner', 'accountant'),
  validate(GenerateReportSchema),
  auditLog('GENERATE_CRG_REPORT', 'ManagementReport'),
  reportsController.generateReport
);

router.post(
  '/generate-all',
  authorize('admin', 'owner', 'accountant'),
  validate(GenerateAllReportsSchema),
  auditLog('GENERATE_ALL_CRG_REPORTS', 'ManagementReport'),
  reportsController.generateAllReports
);

router.get(
  '/:id',
  authorize('admin', 'manager', 'owner', 'accountant'),
  reportsController.getReportById
);

router.patch(
  '/:id/status',
  authorize('admin', 'owner', 'accountant'),
  validate(UpdateReportStatusSchema),
  auditLog('UPDATE_CRG_STATUS', 'ManagementReport'),
  reportsController.updateReportStatus
);

export default router;
