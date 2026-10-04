import { Request, Response } from 'express';
import { organizationsService } from './organizations.service';
import { sendSuccess, sendPaginated, asyncHandler } from '@/shared/helpers/response';
import { getPaginationParams } from '@/shared/helpers/pagination';
import { ForbiddenError, BadRequestError } from '@/shared/errors/AppError';

export const getAllOrganizations = asyncHandler(async (req: Request, res: Response) => {
  const queryParams = getPaginationParams(req);
  const result = await organizationsService.getAllOrganizations(queryParams);
  return sendPaginated(res, result.data, result.meta, 'Organisations récupérées avec succès.');
});

export const getOrganizationById = asyncHandler(async (req: Request, res: Response) => {
  const targetId = req.params.id;
  if (req.user!.role !== 'super_admin' && req.organizationId !== targetId) {
    throw new ForbiddenError('Accès interdit : Vous n\'avez pas accès à cette organisation.');
  }

  const organization = await organizationsService.getOrganizationById(targetId);
  return sendSuccess(res, organization, 'Organisation récupérée.');
});

export const createOrganization = asyncHandler(async (req: Request, res: Response) => {
  const organization = await organizationsService.createOrganization(req.body);
  return sendSuccess(res, organization, 'Organisation créée avec succès.', 201);
});

export const updateOrganization = asyncHandler(async (req: Request, res: Response) => {
  const targetId = req.params.id;
  if (req.user!.role !== 'super_admin' && req.organizationId !== targetId) {
    throw new ForbiddenError('Accès interdit : Vous n\'avez pas accès à cette organisation.');
  }

  const organization = await organizationsService.updateOrganization(targetId, req.body);
  return sendSuccess(res, organization, 'Organisation mise à jour avec succès.');
});

export const getStats = asyncHandler(async (req: Request, res: Response) => {
  const targetId = req.params.id;
  if (req.user!.role !== 'super_admin' && req.organizationId !== targetId) {
    throw new ForbiddenError('Accès interdit : Vous n\'avez pas accès à cette organisation.');
  }

  const stats = await organizationsService.getOrganizationStats(targetId);
  return sendSuccess(res, stats, 'Statistiques récupérées avec succès.');
});

export const requestAccountDeletion = asyncHandler(async (req: Request, res: Response) => {
  const targetId = req.params.id;
  if (req.user!.role !== 'super_admin' && req.organizationId !== targetId) {
    throw new ForbiddenError('Accès interdit : Seul le propriétaire administrateur peut demander la suppression.');
  }

  const { password } = req.body;
  if (!password) {
    throw new BadRequestError('Veuillez saisir votre mot de passe pour confirmer la demande de suppression.');
  }

  const result = await organizationsService.requestAccountDeletion(targetId, req.user!.userId, password);
  return sendSuccess(res, result, result.message);
});

export const cancelAccountDeletion = asyncHandler(async (req: Request, res: Response) => {
  const targetId = req.params.id;
  if (req.user!.role !== 'super_admin' && req.organizationId !== targetId) {
    throw new ForbiddenError('Accès interdit : Vous n\'avez pas accès à cette organisation.');
  }

  const result = await organizationsService.cancelAccountDeletion(targetId, req.user!.userId);
  return sendSuccess(res, result, result.message);
});
