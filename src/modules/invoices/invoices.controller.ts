import { Request, Response } from 'express';
import { invoicesService } from './invoices.service';
import { invoicesRepository } from './invoices.repository';
import { sendSuccess, sendPaginated, asyncHandler } from '@/shared/helpers/response';
import { getPaginationParams } from '@/shared/helpers/pagination';
import { prisma } from '@/config/database';
import { ForbiddenError } from '@/shared/errors/AppError';

export const getAllInvoices = asyncHandler(async (req: Request, res: Response) => {
  const queryParams = getPaginationParams(req);
  const status = req.query.status as string;
  const contractId = req.query.contractId as string;
  const propertyId = req.query.propertyId as string;
  const tenantProfileId = req.query.tenantProfileId as string;
  const month = req.query.month ? parseInt(req.query.month as string) : undefined;
  const year = req.query.year ? parseInt(req.query.year as string) : undefined;

  const result = await invoicesService.getAllInvoices(
    req.organizationId!,
    { ...queryParams, status, contractId, propertyId, tenantProfileId, month, year }
  );

  return sendPaginated(res, result.data, result.meta, 'Factures récupérées avec succès.');
});

export const getInvoiceById = asyncHandler(async (req: Request, res: Response) => {
  const invoice = await invoicesService.getInvoiceById(req.params.id, req.organizationId!);
  
  // Access check: tenant can only view their own invoices
  if (req.user!.role === 'tenant') {
    const profile = await prisma.tenantProfile.findUnique({
      where: { userId: req.user!.userId },
    });
    if (!profile || invoice.tenantProfileId !== profile.id) {
      throw new ForbiddenError('Accès interdit : Cette facture ne vous appartient pas.');
    }
  }

  return sendSuccess(res, invoice, 'Facture récupérée.');
});

export const createInvoice = asyncHandler(async (req: Request, res: Response) => {
  const invoice = await invoicesService.createInvoice(req.body, req.organizationId!);
  return sendSuccess(res, invoice, 'Facture générée manuellement avec succès.', 201);
});

export const triggerPdfGeneration = asyncHandler(async (req: Request, res: Response) => {
  const pdfUrl = await invoicesService.generateInvoicePDF(req.params.id);
  return sendSuccess(res, { pdfUrl }, 'Génération du PDF de la facture lancée avec succès.');
});

export const sendInvoiceToTenant = asyncHandler(async (req: Request, res: Response) => {
  await invoicesService.sendInvoiceEmail(req.params.id);
  return sendSuccess(res, null, 'Facture envoyée au locataire par email.');
});

export const generateMonthlyInvoices = asyncHandler(async (req: Request, res: Response) => {
  const result = await invoicesService.generateMonthlyInvoices(req.organizationId);
  return sendSuccess(res, result, `${result.generatedCount} facture(s) de loyer mensuel générée(s) avec succès.`);
});

export const getStats = asyncHandler(async (req: Request, res: Response) => {
  const stats = await invoicesRepository.getStats(req.organizationId!);
  return sendSuccess(res, stats, 'Statistiques de facturation récupérées.');
});

export const cancelInvoice = asyncHandler(async (req: Request, res: Response) => {
  const reason = req.body.reason || 'Annulation manuelle par le gestionnaire';
  const invoice = await invoicesService.cancelInvoice(req.params.id, reason, req.organizationId!);
  return sendSuccess(res, invoice, 'La facture a été annulée avec succès.');
});
