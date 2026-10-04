import { Request, Response } from 'express';
import { paymentsService } from './payments.service';
import { prisma } from '@/config/database';
import { sendSuccess, sendPaginated, asyncHandler } from '@/shared/helpers/response';
import { getPaginationParams } from '@/shared/helpers/pagination';
import { ForbiddenError, NotFoundError } from '@/shared/errors/AppError';

export const getAllPayments = asyncHandler(async (req: Request, res: Response) => {
  const queryParams = getPaginationParams(req);
  const status = req.query.status as string;
  const contractId = req.query.contractId as string;
  const propertyId = req.query.propertyId as string;
  const tenantProfileId = req.query.tenantProfileId as string;
  const paymentMethod = req.query.paymentMethod as string;
  const startDate = req.query.startDate as string;
  const endDate = req.query.endDate as string;

  const result = await paymentsService.getAllPayments(
    req.organizationId!,
    { ...queryParams, status, contractId, propertyId, tenantProfileId, paymentMethod, startDate, endDate }
  );
  
  return sendPaginated(res, result.data, result.meta, 'Paiements récupérés.');
});

export const getPaymentById = asyncHandler(async (req: Request, res: Response) => {
  const payment = await paymentsService.getPaymentById(req.params.id, req.organizationId!);
  
  // Access check: tenant can only view their own payments
  if (req.user!.role === 'tenant') {
    const tenantProfile = await prisma.tenantProfile.findUnique({
      where: { userId: req.user!.userId },
    });
    if (!tenantProfile || payment.tenantProfileId !== tenantProfile.id) {
      throw new ForbiddenError('Accès interdit : Ce paiement ne vous appartient pas.');
    }
  }

  return sendSuccess(res, payment, 'Paiement récupéré.');
});

export const getPendingPayments = asyncHandler(async (req: Request, res: Response) => {
  const payments = await paymentsService.getPendingPayments(req.organizationId!);
  return sendSuccess(res, payments, 'Paiements en attente récupérés.');
});

export const declarePayment = asyncHandler(async (req: Request, res: Response) => {
  let tenantProfileId = req.body.tenantProfileId;

  // If user is a tenant, automatically load their linked profile ID
  if (req.user!.role === 'tenant') {
    const profile = await prisma.tenantProfile.findUnique({
      where: { userId: req.user!.userId },
    });
    if (!profile) {
      throw new NotFoundError('Profil locataire introuvable pour votre compte.');
    }
    tenantProfileId = profile.id;
  } else if (!tenantProfileId) {
    const contract = await prisma.contract.findUnique({
      where: { id: req.body.contractId },
    });
    if (contract) {
      tenantProfileId = contract.tenantProfileId;
    } else {
      throw new NotFoundError('Contrat introuvable pour ce paiement.');
    }
  }

  const payment = await paymentsService.declarePayment(
    { ...req.body, isTenantSelfDeclaration: req.user!.role === 'tenant' },
    tenantProfileId,
    req.user!.userId,
    req.organizationId!
  );

  return sendSuccess(res, payment, 'Paiement déclaré avec succès.', 201);
});

export const uploadProof = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    return sendSuccess(res, null, 'Aucune preuve de paiement fournie.');
  }

  const proofUrl = `/uploads/${file.filename}`;
  const payment = await paymentsService.uploadProof(req.params.id, proofUrl, req.organizationId!);
  return sendSuccess(res, payment, 'Preuve de paiement téléversée avec succès.');
});

export const validatePayment = asyncHandler(async (req: Request, res: Response) => {
  const payment = await paymentsService.validatePayment(
    req.params.id,
    req.user!.userId,
    req.body,
    req.organizationId!
  );
  return sendSuccess(res, payment, `Paiement traité avec le statut: ${req.body.status}.`);
});

export const getStats = asyncHandler(async (req: Request, res: Response) => {
  const stats = await paymentsService.getStats(req.organizationId!);
  return sendSuccess(res, stats, 'Statistiques de paiement récupérées.');
});
