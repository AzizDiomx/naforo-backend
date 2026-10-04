import { Request, Response } from 'express';
import { contractsService } from './contracts.service';
import { sendSuccess, sendPaginated, asyncHandler } from '@/shared/helpers/response';
import { getPaginationParams } from '@/shared/helpers/pagination';

export const getAllContracts = asyncHandler(async (req: Request, res: Response) => {
  const queryParams = getPaginationParams(req);
  const status = req.query.status as string;
  const propertyId = req.query.propertyId as string;
  const tenantProfileId = req.query.tenantProfileId as string;

  const result = await contractsService.getAllContracts(
    req.organizationId!,
    { ...queryParams, status, propertyId, tenantProfileId }
  );
  
  return sendPaginated(res, result.data, result.meta, 'Contrats de bail récupérés.');
});

export const getContractById = asyncHandler(async (req: Request, res: Response) => {
  const contract = await contractsService.getContractById(req.params.id, req.organizationId!);
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
