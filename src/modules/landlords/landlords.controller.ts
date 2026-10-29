import { Request, Response } from 'express';
import { landlordsService } from './landlords.service';
import { sendSuccess, sendPaginated, asyncHandler } from '@/shared/helpers/response';
import { getPaginationParams } from '@/shared/helpers/pagination';

export const getAllLandlords = asyncHandler(async (req: Request, res: Response) => {
  const queryParams = getPaginationParams(req);
  const status = req.query.status as string;

  const result = await landlordsService.getAllLandlords(
    req.organizationId!,
    { ...queryParams, status }
  );

  return sendPaginated(res, result.data, result.meta, 'Bailleurs mandants récupérés avec succès.');
});

export const getLandlordById = asyncHandler(async (req: Request, res: Response) => {
  const landlord = await landlordsService.getLandlordById(req.params.id, req.organizationId!);
  return sendSuccess(res, landlord, 'Fiche bailleur récupérée avec succès.');
});

export const createLandlord = asyncHandler(async (req: Request, res: Response) => {
  const landlord = await landlordsService.createLandlord(req.organizationId!, req.body);
  return sendSuccess(res, landlord, 'Bailleur mandant créé avec succès.', 201);
});

export const updateLandlord = asyncHandler(async (req: Request, res: Response) => {
  const landlord = await landlordsService.updateLandlord(req.params.id, req.organizationId!, req.body);
  return sendSuccess(res, landlord, 'Fiche bailleur mise à jour avec succès.');
});

export const assignProperties = asyncHandler(async (req: Request, res: Response) => {
  const result = await landlordsService.assignProperties(
    req.params.id,
    req.organizationId!,
    req.body.propertyIds
  );
  return sendSuccess(res, result, 'Patrimoine confié au bailleur mis à jour.');
});

export const deleteLandlord = asyncHandler(async (req: Request, res: Response) => {
  await landlordsService.deleteLandlord(req.params.id, req.organizationId!);
  return sendSuccess(res, null, 'Fiche bailleur supprimée avec succès.');
});
