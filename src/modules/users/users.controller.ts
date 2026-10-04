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
