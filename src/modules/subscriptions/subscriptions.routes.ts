import { Router } from 'express';
import { subscriptionsController } from './subscriptions.controller';
import { authenticate } from '@/shared/middlewares/auth.middleware';
import { authorize } from '@/shared/middlewares/rbac.middleware';
import { validate } from '@/shared/middlewares/validate.middleware';
import { uploadSingle } from '@/shared/middlewares/upload.middleware';
import { CreatePlanSchema, DeclareSubscriptionPaymentSchema, InitiateSaspayPaymentSchema, ValidateSubscriptionPaymentSchema } from './subscriptions.schema';

const router = Router();

// Lecture publique des offres d'abonnement (utilisée par naforo-eagence et le Backoffice)
router.get(
  '/plans',
  subscriptionsController.listPlans
);

// Webhook serveur-à-serveur SasPay (authentifié par signature HMAC-SHA256 X-Webhook-Signature + X-Webhook-Timestamp)
router.post(
  '/webhooks/saspay',
  subscriptionsController.handleSaspayWebhook
);

// Toutes les autres routes d'abonnements exigent une authentification
router.use(authenticate);

// --- PLANS ---
router.post(
  '/plans',
  authorize('super_admin'),
  validate(CreatePlanSchema),
  subscriptionsController.createPlan
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
  authorize('owner', 'admin', 'manager', 'accountant', 'technician'),
  subscriptionsController.getMySubscription
);

// --- PAIEMENTS PROPRIÉTAIRE ---
router.post(
  '/pay',
  authorize('owner', 'admin'),
  validate(DeclareSubscriptionPaymentSchema),
  subscriptionsController.declarePayment
);

// --- PAIEMENT INSTANTANÉ VIA AGRÉGATEUR SASPAY ---
router.get(
  '/saspay/config',
  authorize('owner', 'admin', 'super_admin'),
  subscriptionsController.getSaspayConfig
);

router.post(
  '/saspay/initiate',
  authorize('owner', 'admin'),
  validate(InitiateSaspayPaymentSchema),
  subscriptionsController.initiateSaspayPayment
);

router.get(
  '/saspay/verify/:reference',
  authorize('owner', 'admin'),
  subscriptionsController.verifySaspayPayment
);

router.post(
  '/payments/:id/proof',
  authorize('owner', 'admin'),
  uploadSingle('file'),
  subscriptionsController.uploadProof
);

router.get(
  '/payments/history',
  authorize('owner', 'admin', 'accountant'),
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
