import { Request, Response } from 'express';
import { notificationsService } from './notifications.service';
import { sendSuccess, asyncHandler } from '@/shared/helpers/response';
import { getPaginationParams } from '@/shared/helpers/pagination';

export const getUserNotifications = asyncHandler(async (req: Request, res: Response) => {
  const query = getPaginationParams(req);
  const result = await notificationsService.getUserNotifications(
    req.user!.userId,
    req.user!.role,
    req.organizationId,
    query
  );
  return sendSuccess(res, result, 'Notifications récupérées avec succès.');
});

export const markAsRead = asyncHandler(async (req: Request, res: Response) => {
  const notification = await notificationsService.markAsRead(req.params.id);
  return sendSuccess(res, notification, 'Notification marquée comme lue.');
});

export const markAllAsRead = asyncHandler(async (req: Request, res: Response) => {
  await notificationsService.markAllAsRead(req.user!.userId, req.organizationId);
  return sendSuccess(res, null, 'Toutes les notifications ont été marquées comme lues.');
});

export const getPreferences = asyncHandler(async (req: Request, res: Response) => {
  const prefs = await notificationsService.getPreferences(req.user!.userId);
  return sendSuccess(res, prefs, 'Préférences de notifications récupérées.');
});

export const updatePreferences = asyncHandler(async (req: Request, res: Response) => {
  const prefs = await notificationsService.updatePreferences(req.user!.userId, req.body);
  return sendSuccess(res, prefs, 'Préférences de notifications mises à jour.');
});
