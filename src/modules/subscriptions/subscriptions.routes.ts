import { Router } from 'express';
import { subscriptionsController } from './subscriptions.controller';
import { authenticate } from '@/shared/middlewares/auth.middleware';
import { authorize } from '@/shared/middlewares/rbac.middleware';
import { validate } from '@/shared/middlewares/validate.middleware';
import { uploadSingle } from '@/shared/middlewares/upload.middleware';
import { CreatePlanSchema, DeclareSubscriptionPaymentSchema, ValidateSubscriptionPaymentSchema } from './subscriptions.schema';

const router = Router();

// Toutes les routes d'abonnements exigent une authentification
router.use(authenticate);

// --- PLANS ---
router.post(
  '/plans',
  authorize('super_admin'),
  validate(CreatePlanSchema),
  subscriptionsController.createPlan
);

router.get(
  '/plans',
  subscriptionsController.listPlans
);

router.put(
  '/plans/:id',
  authorize('super_admin'),
  subscriptionsController.updatePlan
);

router.patch(
  '/plans/:id/status',
  authorize('super_admin'),
  subscriptionsController.togglePlanStatus
);

router.delete(
  '/plans/:id',
  authorize('super_admin'),
  subscriptionsController.deletePlan
);

// --- MON ABONNEMENT ---
router.get(
  '/me',
  authorize('owner', 'admin'),
  subscriptionsController.getMySubscription
);

// --- PAIEMENTS PROPRIÉTAIRE ---
router.post(
  '/pay',
  authorize('owner', 'admin'),
  validate(DeclareSubscriptionPaymentSchema),
  subscriptionsController.declarePayment
);

router.post(
  '/payments/:id/proof',
  authorize('owner', 'admin'),
  uploadSingle('file'),
  subscriptionsController.uploadProof
);

router.get(
  '/payments/history',
  authorize('owner', 'admin'),
  subscriptionsController.getPaymentsHistory
);

// --- EXPORT COMPLET DE DONNÉES / BACKUP DE RÉTENTION ---
router.get(
  '/export-data',
  authorize('owner', 'admin'),
  subscriptionsController.exportData
);
router.get(
  '/backup',
  authorize('owner', 'admin'),
  subscriptionsController.exportData
);

// --- SUPERADMIN SERVICES ---
router.get(
  '/payments/pending',
  authorize('super_admin'),
  subscriptionsController.getPendingPayments
);

router.get(
  '/admin/stats',
  authorize('super_admin'),
  subscriptionsController.getAdminStats
);

router.put(
  '/payments/:id/validate',
  authorize('super_admin'),
  validate(ValidateSubscriptionPaymentSchema),
  subscriptionsController.validatePayment
);

export default router;
