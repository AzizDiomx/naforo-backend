import { Request, Response } from 'express';
import { contractsService } from './contracts.service';
import { prisma } from '@/config/database';
import { ForbiddenError } from '@/shared/errors/AppError';
import { sendSuccess, sendPaginated, asyncHandler } from '@/shared/helpers/response';
import { getPaginationParams } from '@/shared/helpers/pagination';

async function assertTenantOwnsContract(req: Request, contract: { tenantProfileId: string }) {
  if (req.user?.role === 'tenant') {
    const profile = await prisma.tenantProfile.findUnique({
      where: { userId: req.user.userId },
      select: { id: true },
    });
    if (!profile || contract.tenantProfileId !== profile.id) {
      throw new ForbiddenError('Accès interdit : Ce contrat de bail ne vous appartient pas.');
    }
  }
}

export const getAllContracts = asyncHandler(async (req: Request, res: Response) => {
  const queryParams = getPaginationParams(req);
  const status = req.query.status as string;
  const propertyId = req.query.propertyId as string;
  const tenantProfileId = req.query.tenantProfileId as string;

  const result = await contractsService.getAllContracts(
    req.organizationId!,
    { ...queryParams, status, propertyId, tenantProfileId },
    req.user
  );
  
  return sendPaginated(res, result.data, result.meta, 'Contrats de bail récupérés.');
});

export const getContractById = asyncHandler(async (req: Request, res: Response) => {
  const contract = await contractsService.getContractById(req.params.id, req.organizationId!);
  await assertTenantOwnsContract(req, contract);
  return sendSuccess(res, contract, 'Contrat de bail récupéré.');
});

export const createContract = asyncHandler(async (req: Request, res: Response) => {
  const contract = await contractsService.createContract(
    req.body,
    req.organizationId!,
    req.user!.userId
  );
  return sendSuccess(res, contract, 'Contrat de bail créé avec succès.', 201);
});

export const updateContract = asyncHandler(async (req: Request, res: Response) => {
  const contract = await contractsService.updateContract(
    req.params.id,
    req.body,
    req.organizationId!
  );
  return sendSuccess(res, contract, 'Contrat de bail mis à jour.');
});

export const terminateContract = asyncHandler(async (req: Request, res: Response) => {
  const contract = await contractsService.terminateContract(
    req.params.id,
    req.body,
    req.organizationId!
  );
  return sendSuccess(res, contract, 'Contrat de bail résilié avec succès.');
});

export const getExpiringSoon = asyncHandler(async (req: Request, res: Response) => {
  const days = req.query.days ? parseInt(req.query.days as string) : 30;
  const contracts = await contractsService.getExpiringContracts(req.organizationId!, days);
  return sendSuccess(res, contracts, 'Contrats expirant bientôt récupérés.');
});

export const getStats = asyncHandler(async (req: Request, res: Response) => {
  const stats = await contractsService.getStats(req.organizationId!);
  return sendSuccess(res, stats, 'Statistiques des contrats récupérées.');
});

export const generatePdf = asyncHandler(async (req: Request, res: Response) => {
  const contract = await contractsService.getContractById(req.params.id, req.organizationId!);
  await assertTenantOwnsContract(req, contract);
  const result = await contractsService.generateContractPDFDocument(req.params.id, req.organizationId!);
  return sendSuccess(res, result, 'Document du bail généré avec succès.');
});

export const sendSignatureOtp = asyncHandler(async (req: Request, res: Response) => {
  const result = await contractsService.sendSignatureOtp(
    req.params.id,
    req.organizationId!,
    req.body.phone
  );
  return sendSuccess(res, result, result.message);
});

export const signContractWithOtp = asyncHandler(async (req: Request, res: Response) => {
  const contract = await contractsService.getContractById(req.params.id, req.organizationId!);
  await assertTenantOwnsContract(req, contract);

  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || 'Naforo Web App';

  const result = await contractsService.signContractWithOtp(
    req.params.id,
    req.organizationId!,
    req.body.otp,
    ip,
    userAgent,
    req.body.drawSignature
  );
  return sendSuccess(res, result, result.message);
});

export const bypassSignature = asyncHandler(async (req: Request, res: Response) => {
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || 'Naforo Web App';

  const result = await contractsService.bypassContractSignature(
    req.params.id,
    req.organizationId!,
    req.user!.userId,
    ip,
    userAgent,
    req.body?.reason
  );
  return sendSuccess(res, result, result.message);
});
