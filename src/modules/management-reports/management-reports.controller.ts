import { Request, Response } from 'express';
import { managementReportsService } from './management-reports.service';
import { sendSuccess, sendPaginated, asyncHandler } from '@/shared/helpers/response';
import { getPaginationParams } from '@/shared/helpers/pagination';
import { BadRequestError } from '@/shared/errors/AppError';

export const generateReport = asyncHandler(async (req: Request, res: Response) => {
  const { landlordId, otherDeductions, notes } = req.body;
  const rawMonth = req.body.periodMonth ?? req.body.month;
  const rawYear = req.body.periodYear ?? req.body.year;

  if (!rawMonth || !rawYear) {
    throw new BadRequestError('Le mois (periodMonth ou month) et l\'année (periodYear ou year) sont requis.');
  }

  const report = await managementReportsService.generateReport(
    req.organizationId!,
    landlordId,
    Number(rawMonth),
    Number(rawYear),
    { otherDeductions: otherDeductions ? Number(otherDeductions) : 0, notes },
    req.user?.userId
  );
  return sendSuccess(res, report, 'Compte-rendu de gestion généré avec succès.', 201);
});

export const generateAllReports = asyncHandler(async (req: Request, res: Response) => {
  const rawMonth = req.body.periodMonth ?? req.body.month;
  const rawYear = req.body.periodYear ?? req.body.year;

  if (!rawMonth || !rawYear) {
    throw new BadRequestError('Le mois (periodMonth ou month) et l\'année (periodYear ou year) sont requis.');
  }

  const result = await managementReportsService.generateAllReports(
    req.organizationId!,
    Number(rawMonth),
    Number(rawYear),
    req.user?.userId
  );
  return sendSuccess(res, result, `${result.generatedCount} compte(s)-rendu(s) de gestion généré(s) avec succès.`);
});

export const getAllReports = asyncHandler(async (req: Request, res: Response) => {
  const queryParams = getPaginationParams(req);
  const landlordId = req.query.landlordId as string;
  const rawMonth = req.query.periodMonth || req.query.month;
  const rawYear = req.query.periodYear || req.query.year;
  const periodMonth = rawMonth ? Number(rawMonth) : undefined;
  const periodYear = rawYear ? Number(rawYear) : undefined;
  const status = req.query.status as string;

  const result = await managementReportsService.getAllReports(
    req.organizationId!,
    { ...queryParams, landlordId, periodMonth, periodYear, status }
  );

  return sendPaginated(res, result.data, result.meta, 'Comptes-rendus de gestion récupérés.');
});

export const getReportById = asyncHandler(async (req: Request, res: Response) => {
  const report = await managementReportsService.getReportById(req.params.id, req.organizationId!);
  return sendSuccess(res, report, 'Compte-rendu de gestion récupéré.');
});

export const updateReportStatus = asyncHandler(async (req: Request, res: Response) => {
  const rawStatus = req.body.status;
  const status = rawStatus === 'paid' ? 'paid_out' : rawStatus;
  const paymentReference = req.body.paymentReference ?? req.body.paymentRef;
  const paymentDate = req.body.paymentDate ?? req.body.paidAt;
  const notes = req.body.notes;

  const updated = await managementReportsService.updateReportStatus(
    req.params.id,
    req.organizationId!,
    { status, paymentReference, paymentDate, notes }
  );
  return sendSuccess(res, updated, 'Statut du compte-rendu de gestion mis à jour.');
});
