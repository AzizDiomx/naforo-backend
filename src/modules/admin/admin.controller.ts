import { Request, Response } from 'express';
import * as adminService from './admin.service';
import { sendSuccess, asyncHandler } from '@/shared/helpers/response';

export const getAdvancedStats = asyncHandler(async (req: Request, res: Response) => {
  const stats = await adminService.getAdvancedStats();
  return sendSuccess(res, stats, 'Statistiques avancées SuperAdmin récupérées.');
});

export const broadcastNotification = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.broadcastNotification(req.body);
  return sendSuccess(res, result, `Notification diffusée à ${result.recipientCount} utilisateur(s).`);
});

export const getAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.getAuditLogs({
    page: Number(req.query.page),
    limit: Number(req.query.limit),
    search: req.query.search as string,
    action: req.query.action as string,
    entityType: req.query.entityType as string,
    organizationId: req.query.organizationId as string,
  });
  return sendSuccess(res, result, 'Journaux de la piste d\'audit récupérés.');
});
