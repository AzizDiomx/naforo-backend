import { Request, Response } from 'express';
import { dashboardService } from './dashboard.service';
import { sendSuccess, asyncHandler } from '@/shared/helpers/response';
import { ForbiddenError } from '@/shared/errors/AppError';

export const getOwnerDashboard = asyncHandler(async (req: Request, res: Response) => {
  const result = await dashboardService.getOwnerDashboard(req.organizationId!);
  return sendSuccess(res, result, 'Données du tableau de bord propriétaire récupérées.');
});

export const getTenantDashboard = asyncHandler(async (req: Request, res: Response) => {
  const result = await dashboardService.getTenantDashboard(req.user!.userId, req.organizationId!);
  return sendSuccess(res, result, 'Données du tableau de bord locataire récupérées.');
});

export const getRealtimeChannelInfo = asyncHandler(async (req: Request, res: Response) => {
  const channels = {
    userChannel: `user:${req.user!.userId}`,
    orgChannel: req.organizationId ? `org:${req.organizationId}` : null,
    dashboardChannel: req.organizationId ? `dashboard:${req.organizationId}` : null,
  };
  return sendSuccess(res, channels, 'Canaux Socket.IO récupérés.');
});
