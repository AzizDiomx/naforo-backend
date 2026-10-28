import { Request, Response } from 'express';
import { usersService } from './users.service';
import { sendSuccess, sendPaginated, asyncHandler } from '@/shared/helpers/response';
import { getPaginationParams } from '@/shared/helpers/pagination';

function sanitizeUser(user: any) {
  if (!user) return user;
  const { passwordHash, refreshTokenHash, ...sanitized } = user;
  return sanitized;
}

export const getAllUsers = asyncHandler(async (req: Request, res: Response) => {
  const queryParams = getPaginationParams(req);
  const result = await usersService.getAllUsers(req.organizationId!, queryParams);
  
  const sanitizedUsers = result.data.map(sanitizeUser);
  return sendPaginated(res, sanitizedUsers, result.meta, 'Utilisateurs récupérés avec succès.');
});

export const getUserById = asyncHandler(async (req: Request, res: Response) => {
  const user = await usersService.getUserById(req.params.id, req.organizationId!);
  return sendSuccess(res, sanitizeUser(user), 'Utilisateur récupéré.');
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await usersService.createUser(req.body, req.organizationId!);
  return sendSuccess(res, sanitizeUser(user), 'Utilisateur créé avec succès.', 201);
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await usersService.updateUser(req.params.id, req.body, req.organizationId!);
  return sendSuccess(res, sanitizeUser(user), 'Utilisateur mis à jour avec succès.');
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  await usersService.deleteUser(req.params.id, req.organizationId!);
  return sendSuccess(res, null, 'Utilisateur supprimé avec succès.');
});

export const updateFCMToken = asyncHandler(async (req: Request, res: Response) => {
  await usersService.updateFCMToken(req.user!.userId, req.body.fcmToken);
  return sendSuccess(res, null, 'Token de notification Push mis à jour.');
});

export const getManagers = asyncHandler(async (req: Request, res: Response) => {
  const managers = await usersService.getManagers(req.organizationId!);
  return sendSuccess(res, managers, 'Gestionnaires et collaborateurs récupérés avec succès.');
});

export const createManager = asyncHandler(async (req: Request, res: Response) => {
  const manager = await usersService.createManager(req.organizationId!, req.body);
  return sendSuccess(res, manager, 'Collaborateur créé avec succès.', 201);
});

export const updateManagerPortfolio = asyncHandler(async (req: Request, res: Response) => {
  const updated = await usersService.updateManagerPortfolio(
    req.organizationId!,
    req.params.id,
    req.body.propertyIds
  );
  return sendSuccess(res, updated, 'Portefeuille du gestionnaire mis à jour avec succès.');
});

export const updateManagerStatus = asyncHandler(async (req: Request, res: Response) => {
  const isActive = req.body.isActive !== undefined ? Boolean(req.body.isActive) : true;
  const updated = await usersService.updateManagerStatus(
    req.organizationId!,
    req.params.id,
    isActive
  );
  return sendSuccess(res, updated, 'Statut du gestionnaire mis à jour avec succès.');
});
