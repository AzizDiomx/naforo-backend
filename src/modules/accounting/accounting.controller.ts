import { Request, Response } from 'express';
import { AccountingService } from './accounting.service';
import { accountingRepository } from './accounting.repository';
import { sendSuccess, asyncHandler } from '@/shared/helpers/response';
import { CreateExpenseSchema, ReturnDepositSchema, ManualRateSchema, TransactionQuerySchema } from './accounting.schema';
import { getPaginationParams } from '@/shared/helpers/pagination';
import { ForbiddenError } from '@/shared/errors/AppError';

const accountingService = new AccountingService();

export const accountingController = {

  getExchangeRates: asyncHandler(async (req: Request, res: Response) => {
    const rates = await accountingRepository.getLatestRatesForDisplay();
    return sendSuccess(res, {
      baseCurrency: 'XOF',
      rates,
      updatedAt: new Date().toISOString(),
    }, 'Taux de change en direct récupérés avec succès');
  }),

  // ─── Transactions ──────────────────────────────────────────────────────────

  createExpense: asyncHandler(async (req: Request, res: Response) => {
    if (!['admin', 'manager', 'owner'].includes(req.user!.role)) {
      throw new ForbiddenError("Seuls les propriétaires et gestionnaires peuvent déclarer des dépenses");
    }

    const data = CreateExpenseSchema.parse(req.body);
    const expense = await accountingService.createExpense(req.user!.userId, req.organizationId!, data);
    
    return sendSuccess(res, expense, 'Dépense comptabilisée avec succès', 201);
  }),

  getTransactions: asyncHandler(async (req: Request, res: Response) => {
    const filters = TransactionQuerySchema.parse(req.query);
    const pagination = getPaginationParams(req);

    const result = await accountingService.getTransactions(req.organizationId!, {
      ...filters,
      page: pagination.page,
      limit: pagination.limit,
    });

    return sendSuccess(res, result, 'Transactions comptables récupérées avec succès');
  }),

  deleteTransaction: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    await accountingService.deleteTransaction(id, req.organizationId!, req.user!.userId);
    return sendSuccess(res, null, 'Écriture comptable supprimée avec succès');
  }),

  // ─── P&L par Bien ──────────────────────────────────────────────────────────

  getPropertyPnl: asyncHandler(async (req: Request, res: Response) => {
    const { propertyId } = req.params;
    const year = req.query.year ? parseInt(req.query.year as string, 10) : new Date().getFullYear();
    const month = req.query.month ? parseInt(req.query.month as string, 10) : undefined;

    const pnl = await accountingService.getPropertyPnl(req.organizationId!, propertyId, year, month);
    return sendSuccess(res, pnl, 'Compte de résultat (P&L) récupéré avec succès');
  }),

  // ─── Dashboard Financier Consolidé ──────────────────────────────────────────

  getFinancialDashboard: asyncHandler(async (req: Request, res: Response) => {
    const year = req.query.year ? parseInt(req.query.year as string, 10) : new Date().getFullYear();
    const month = req.query.month ? parseInt(req.query.month as string, 10) : new Date().getMonth() + 1;

    const dashboard = await accountingService.getFinancialDashboard(req.organizationId!, year, month);
    return sendSuccess(res, dashboard, 'Dashboard financier récupéré avec succès');
  }),

  // ─── Dépôts de Garantie ───────────────────────────────────────────────────

  createDeposit: asyncHandler(async (req: Request, res: Response) => {
    const { contractId } = req.params;
    const { amountReceivedXof, receivedAt, notes } = req.body;

    if (!amountReceivedXof || !receivedAt) {
      throw new ForbiddenError("Le montant reçu et la date de réception sont obligatoires");
    }

    const deposit = await accountingService.createDeposit(req.organizationId!, contractId, {
      amountReceivedXof: Number(amountReceivedXof),
      receivedAt: new Date(receivedAt),
      notes,
    });

    return sendSuccess(res, deposit, 'Dépôt de garantie enregistré avec succès', 201);
  }),

  getDeposit: asyncHandler(async (req: Request, res: Response) => {
    const { contractId } = req.params;
    const deposit = await accountingService.getDeposit(contractId, req.organizationId!);
    return sendSuccess(res, deposit, 'Dépôt de garantie récupéré avec succès');
  }),

  processDepositReturn: asyncHandler(async (req: Request, res: Response) => {
    const { contractId } = req.params;
    const data = ReturnDepositSchema.parse(req.body);

    const deposit = await accountingService.processDepositReturn(contractId, req.organizationId!, data);
    return sendSuccess(res, deposit, 'Restitution de dépôt de garantie traitée avec succès');
  }),

  // ─── Taux de change manuels (Admin seulement) ─────────────────────────────

  updateManualRate: asyncHandler(async (req: Request, res: Response) => {
    if (req.user!.role !== 'super_admin' && req.user!.role !== 'admin') {
      throw new ForbiddenError("Privilèges insuffisants pour modifier les taux de change");
    }

    const { targetCurrency, rate } = ManualRateSchema.parse(req.body);
    await accountingService.updateManualRate(targetCurrency, rate);

    return sendSuccess(res, null, 'Taux de change mis à jour avec succès');
  }),

  // ─── Exportation Excel .xlsx ──────────────────────────────────────────────

  exportExcelReport: asyncHandler(async (req: Request, res: Response) => {
    const year = req.query.year ? parseInt(req.query.year as string, 10) : new Date().getFullYear();
    const buffer = await accountingService.exportFinancialReportToExcel(req.organizationId!, year);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Bilan_Comptable_Naforo_${year}.xlsx`);
    return res.status(200).send(buffer);
  }),
};

