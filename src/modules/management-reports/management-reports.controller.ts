import { Request, Response } from 'express';
import { managementReportsService } from './management-reports.service';
import { sendSuccess, sendPaginated, asyncHandler } from '@/shared/helpers/response';
import { getPaginationParams } from '@/shared/helpers/pagination';

export const generateReport = asyncHandler(async (req: Request, res: Response) => {
  const { landlordId, periodMonth, periodYear, otherDeductions, notes } = req.body;
  const report = await managementReportsService.generateReport(
    req.organizationId!,
    landlordId,
    Number(periodMonth),
    Number(periodYear),
    { otherDeductions, notes },
    req.user?.userId
  );
  return sendSuccess(res, report, 'Compte-rendu de gestion généré avec succès.', 201);
});

export const generateAllReports = asyncHandler(async (req: Request, res: Response) => {
  const { periodMonth, periodYear } = req.body;
  const result = await managementReportsService.generateAllReports(
    req.organizationId!,
    Number(periodMonth),
    Number(periodYear),
    req.user?.userId
  );
  return sendSuccess(res, result, `${result.generatedCount} compte(s)-rendu(s) de gestion généré(s) avec succès.`);
});

export const getAllReports = asyncHandler(async (req: Request, res: Response) => {
  const queryParams = getPaginationParams(req);
  const landlordId = req.query.landlordId as string;
  const periodMonth = req.query.periodMonth ? Number(req.query.periodMonth) : undefined;
  const periodYear = req.query.periodYear ? Number(req.query.periodYear) : undefined;
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
  const updated = await managementReportsService.updateReportStatus(
    req.params.id,
    req.organizationId!,
    req.body
  );
  return sendSuccess(res, updated, 'Statut du compte-rendu de gestion mis à jour.');
});
