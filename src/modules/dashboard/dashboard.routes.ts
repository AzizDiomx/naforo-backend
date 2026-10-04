import { Router } from 'express';
import * as dashboardController from './dashboard.controller';
import { authenticate } from '@/shared/middlewares/auth.middleware';
import { authorize } from '@/shared/middlewares/rbac.middleware';
import { requireTenant } from '@/shared/middlewares/tenant.middleware';

const router = Router();

router.use(authenticate);
router.use(requireTenant);

router.get(
  '/owner', 
  authorize('admin', 'manager', 'owner'), 
  dashboardController.getOwnerDashboard
);

router.get(
  '/tenant', 
  authorize('tenant'), 
  dashboardController.getTenantDashboard
);

router.get(
  '/realtime', 
  dashboardController.getRealtimeChannelInfo
);

export default router;
