import { Request, Response } from 'express';
import { receiptsService } from './receipts.service';
import { sendSuccess, sendPaginated, asyncHandler } from '@/shared/helpers/response';
import { getPaginationParams } from '@/shared/helpers/pagination';
import { prisma } from '@/config/database';
import { ForbiddenError } from '@/shared/errors/AppError';

export const getAllReceipts = asyncHandler(async (req: Request, res: Response) => {
  const queryParams = getPaginationParams(req);
  const contractId = req.query.contractId as string;
  const tenantProfileId = req.query.tenantProfileId as string;

  const result = await receiptsService.getAllReceipts(
    req.organizationId!,
    { ...queryParams, contractId, tenantProfileId }
  );

  return sendPaginated(res, result.data, result.meta, 'Quittances récupérées avec succès.');
});

export const getReceiptById = asyncHandler(async (req: Request, res: Response) => {
  const receipt = await receiptsService.getReceiptById(req.params.id, req.organizationId!);

  // Access check: tenant can only view their own receipts
  if (req.user!.role === 'tenant') {
    const profile = await prisma.tenantProfile.findUnique({
      where: { userId: req.user!.userId },
    });
    if (!profile || receipt.tenantProfileId !== profile.id) {
      throw new ForbiddenError('Accès interdit : Cette quittance ne vous appartient pas.');
    }
  }

  return sendSuccess(res, receipt, 'Quittance récupérée.');
});

export const verifyReceipt = asyncHandler(async (req: Request, res: Response) => {
  const receiptNumber = req.params.receiptNumber;
  const signature = req.query.sig as string;

  if (!signature) {
    throw new ForbiddenError('Signature numérique obligatoire pour la vérification.');
  }

  const receipt = await receiptsService.verifyReceipt(receiptNumber, signature);
  return sendSuccess(res, receipt, 'Quittance vérifiée et valide.');
});

export const downloadReceipt = asyncHandler(async (req: Request, res: Response) => {
  const receipt = await receiptsService.getReceiptById(req.params.id, req.organizationId!);
  
  if (req.user!.role === 'tenant') {
    const profile = await prisma.tenantProfile.findUnique({
      where: { userId: req.user!.userId },
    });
    if (!profile || receipt.tenantProfileId !== profile.id) {
      throw new ForbiddenError('Accès interdit : Cette quittance ne vous appartient pas.');
    }
  }

  return sendSuccess(res, { pdfUrl: receipt.pdfUrl }, 'Lien de téléchargement récupéré.');
});
