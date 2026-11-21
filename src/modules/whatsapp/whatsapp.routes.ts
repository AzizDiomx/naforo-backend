import { Router } from 'express';
import * as whatsappController from './whatsapp.controller';
import { authenticate } from '@/shared/middlewares/auth.middleware';
import { authorize } from '@/shared/middlewares/rbac.middleware';
import { requireTenant } from '@/shared/middlewares/tenant.middleware';
import { auditLog } from '@/shared/middlewares/audit.middleware';
import { checkSubscription, requirePlanFeature } from '@/shared/middlewares/subscription.middleware';

const router = Router();

router.use(authenticate);
router.use(requireTenant);
router.use(checkSubscription);
router.use(requirePlanFeature('sms_whatsapp', 'Relances et notifications par WhatsApp'));

// Statistiques d'envois WhatsApp
router.get(
  '/stats',
  authorize('admin', 'manager', 'accountant', 'owner'),
  whatsappController.getStats
);

// Historique / Journaux d'envois WhatsApp
router.get(
  '/logs',
  authorize('admin', 'manager', 'accountant', 'owner'),
  whatsappController.getLogs
);

// Relance groupée de plusieurs factures en retard / en attente
router.post(
  '/invoices/bulk-remind',
  authorize('admin', 'manager', 'accountant', 'owner'),
  auditLog('SEND_BULK_WHATSAPP_INVOICE_REMINDER', 'Invoice'),
  whatsappController.bulkRemindInvoices
);

// Relance 1-clic pour une facture
router.post(
  '/invoices/:id/remind',
  authorize('admin', 'manager', 'accountant', 'owner'),
  auditLog('SEND_WHATSAPP_INVOICE_REMINDER', 'Invoice'),
  whatsappController.remindInvoice
);

// Envoi d'un message direct personnalisé
router.post(
  '/send',
  authorize('admin', 'manager', 'owner'),
  auditLog('SEND_CUSTOM_WHATSAPP', 'WhatsAppLog'),
  whatsappController.sendCustom
);

export default router;
