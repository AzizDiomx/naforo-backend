import { Router } from 'express';
import * as adminController from './admin.controller';
import { authenticate } from '@/shared/middlewares/auth.middleware';
import { authorize } from '@/shared/middlewares/rbac.middleware';
import { auditLog } from '@/shared/middlewares/audit.middleware';

const router = Router();

/**
 * @route   POST /api/v1/admin/public/eagence-visit
 * @desc    Enregistre une visite sur le site vitrine naforo-eagence et notifie les administrateurs
 */
router.post('/public/eagence-visit', adminController.recordEagenceVisit);

router.use(authenticate);
router.use(authorize('super_admin'));

/**
 * @route   GET /api/v1/admin/stats/advanced
 * @desc    Get platform-wide advanced analytics & KPI metrics
 */
router.get('/stats/advanced', adminController.getAdvancedStats);

/**
 * @route   POST /api/v1/admin/notifications/broadcast
 * @desc    Broadcast internal notification to target users/agencies
 */
router.post(
  '/notifications/broadcast',
  auditLog('BROADCAST_NOTIFICATION', 'Notification'),
  adminController.broadcastNotification
);

/**
 * @route   GET /api/v1/admin/audit-logs
 * @desc    Get system audit log trail (super_admin)
 */
router.get('/audit-logs', adminController.getAuditLogs);

export default router;
