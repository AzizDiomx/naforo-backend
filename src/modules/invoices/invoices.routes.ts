import { Router } from 'express';
import * as invoicesController from './invoices.controller';
import { validate } from '@/shared/middlewares/validate.middleware';
import { authenticate } from '@/shared/middlewares/auth.middleware';
import { authorize } from '@/shared/middlewares/rbac.middleware';
import { requireTenant } from '@/shared/middlewares/tenant.middleware';
import { auditLog } from '@/shared/middlewares/audit.middleware';
import { CreateInvoiceSchema, UpdateInvoiceSchema } from './invoices.schema';

const router = Router();

router.use(authenticate);
router.use(requireTenant);

router.get(
  '/', 
  authorize('admin', 'manager', 'accountant', 'owner'), 
  invoicesController.getAllInvoices
);

router.get(
  '/stats', 
  authorize('admin', 'manager', 'accountant', 'owner'), 
  invoicesController.getStats
);

router.get(
  '/:id', 
  authorize('admin', 'manager', 'accountant', 'owner', 'tenant'), 
  invoicesController.getInvoiceById
);

router.post(
  '/', 
  authorize('admin', 'manager', 'owner'), 
  validate(CreateInvoiceSchema), 
  auditLog('CREATE_INVOICE', 'Invoice'),
  invoicesController.createInvoice
);

router.post(
  '/:id/pdf', 
  authorize('admin', 'manager', 'accountant', 'owner'), 
  auditLog('GENERATE_INVOICE_PDF', 'Invoice'),
  invoicesController.triggerPdfGeneration
);

router.post(
  '/generate-monthly',
  authorize('admin', 'manager', 'owner'),
  auditLog('GENERATE_MONTHLY_INVOICES', 'Invoice'),
  invoicesController.generateMonthlyInvoices
);

router.post(
  '/:id/send', 
  authorize('admin', 'manager', 'accountant', 'owner'), 
  auditLog('SEND_INVOICE_EMAIL', 'Invoice'),
  invoicesController.sendInvoiceToTenant
);

router.put(
  '/:id/cancel', 
  authorize('admin', 'manager', 'owner'), 
  auditLog('CANCEL_INVOICE', 'Invoice'),
  invoicesController.cancelInvoice
);

export default router;
