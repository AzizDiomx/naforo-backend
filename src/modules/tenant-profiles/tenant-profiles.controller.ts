import { Request, Response } from 'express';
import { tenantProfilesService } from './tenant-profiles.service';
import { sendSuccess, sendPaginated, asyncHandler } from '@/shared/helpers/response';
import { getPaginationParams } from '@/shared/helpers/pagination';

export const getAllTenantProfiles = asyncHandler(async (req: Request, res: Response) => {
  const queryParams = getPaginationParams(req);
  const result = await tenantProfilesService.getAllTenantProfiles(req.organizationId!, queryParams);
  return sendPaginated(res, result.data, result.meta, 'Profils locataires récupérés.');
});

export const getTenantProfileById = asyncHandler(async (req: Request, res: Response) => {
  const profile = await tenantProfilesService.getTenantProfileById(req.params.id, req.organizationId!);
  return sendSuccess(res, profile, 'Profil locataire récupéré.');
});

export const createTenantProfile = asyncHandler(async (req: Request, res: Response) => {
  const profile = await tenantProfilesService.createTenantProfile(req.body, req.organizationId!);
  return sendSuccess(res, profile, 'Profil locataire créé avec succès.', 201);
});

export const updateTenantProfile = asyncHandler(async (req: Request, res: Response) => {
  const profile = await tenantProfilesService.updateTenantProfile(
    req.params.id,
    req.body,
    req.organizationId!
  );
  return sendSuccess(res, profile, 'Profil locataire mis à jour.');
});

export const uploadAvatar = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    return sendSuccess(res, null, 'Aucun fichier fourni.');
  }

  const avatarUrl = `/uploads/${file.filename}`;
  const profile = await tenantProfilesService.uploadAvatar(req.params.id, avatarUrl, req.organizationId!);
  return sendSuccess(res, profile, 'Avatar mis à jour avec succès.');
});

export const getHistory = asyncHandler(async (req: Request, res: Response) => {
  const history = await tenantProfilesService.getTenantHistory(req.params.id, req.organizationId!);
  return sendSuccess(res, history, 'Carnet numérique (historique) récupéré.');
});

export const deleteTenantProfile = asyncHandler(async (req: Request, res: Response) => {
  await tenantProfilesService.deleteTenantProfile(req.params.id, req.organizationId!);
  return sendSuccess(res, null, 'Profil locataire supprimé.');
});
