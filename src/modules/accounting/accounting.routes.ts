import { Router } from 'express';
import { accountingController } from './accounting.controller';
import { authenticate } from '@/shared/middlewares/auth.middleware';
import { authorize } from '@/shared/middlewares/rbac.middleware';
import { validate } from '@/shared/middlewares/validate.middleware';
import { CreateExpenseSchema, ReturnDepositSchema, ManualRateSchema } from './accounting.schema';

import { checkSubscription } from '@/shared/middlewares/subscription.middleware';

const router = Router();

// Toutes les routes comptables requièrent d'être authentifié
router.use(authenticate);
router.use(checkSubscription);

// --- Transactions & Dépenses ---
router.post(
  '/expenses',
  authorize('admin', 'manager', 'owner'),
  validate(CreateExpenseSchema),
  accountingController.createExpense
);

router.get(
  '/transactions',
  authorize('super_admin', 'admin', 'manager', 'accountant', 'owner'),
  accountingController.getTransactions
);

router.delete(
  '/transactions/:id',
  authorize('owner'),
  accountingController.deleteTransaction
);

// --- États financiers ---
router.get(
  '/property/:propertyId/pnl',
  authorize('super_admin', 'admin', 'manager', 'accountant', 'owner'),
  accountingController.getPropertyPnl
);

router.get(
  '/dashboard',
  authorize('super_admin', 'admin', 'manager', 'accountant', 'owner'),
  accountingController.getFinancialDashboard
);

import { requirePlanFeature } from '@/shared/middlewares/subscription.middleware';

router.get(
  '/export/excel',
  authorize('super_admin', 'admin', 'manager', 'accountant', 'owner'),
  requirePlanFeature('excel_export', 'Exports Comptables Excel & Bilans DGI'),
  accountingController.exportExcelReport
);

// --- Dépôts de garantie (Cautions) ---
router.post(
  '/contract/:contractId/deposit',
  authorize('admin', 'manager', 'owner'),
  accountingController.createDeposit
);

router.get(
  '/contract/:contractId/deposit',
  authorize('admin', 'manager', 'owner', 'tenant'),
  accountingController.getDeposit
);

router.put(
  '/contract/:contractId/deposit/return',
  authorize('admin', 'manager', 'owner'),
  validate(ReturnDepositSchema),
  accountingController.processDepositReturn
);

// --- Taux de change (Consultation & Mises à jour manuelles) ---
router.get(
  '/rates',
  authorize('super_admin', 'admin', 'manager', 'accountant', 'owner'),
  accountingController.getExchangeRates
);

router.post(
  '/rates',
  authorize('super_admin', 'admin'),
  validate(ManualRateSchema),
  accountingController.updateManualRate
);

export default router;
