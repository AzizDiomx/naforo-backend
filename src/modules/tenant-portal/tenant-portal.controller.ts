import { Request, Response } from 'express';
import * as tenantPortalService from './tenant-portal.service';
import { sendSuccess, asyncHandler } from '@/shared/helpers/response';

export const getTenantOverview = asyncHandler(async (req: Request, res: Response) => {
  const data = await tenantPortalService.getTenantOverview(req.user!.userId);
  return sendSuccess(res, data, "Données de bord locataire récupérées avec succès");
});

export const getMyPayments = asyncHandler(async (req: Request, res: Response) => {
  const data = await tenantPortalService.getMyPayments(req.user!.userId);
  return sendSuccess(res, data, "Historique des paiements récupéré");
});

export const declarePayment = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  const payment = await tenantPortalService.declarePayment(req.user!.userId, req.body, file);
  return sendSuccess(res, payment, "Déclaration de paiement transmise avec succès", 201);
});

export const getMyReceipts = asyncHandler(async (req: Request, res: Response) => {
  const data = await tenantPortalService.getMyReceipts(req.user!.userId);
  return sendSuccess(res, data, "Quittances locataire récupérées");
});

export const getMyIncidents = asyncHandler(async (req: Request, res: Response) => {
  const data = await tenantPortalService.getMyIncidents(req.user!.userId);
  return sendSuccess(res, data, "Incidents locataire récupérés");
});

export const reportIncident = asyncHandler(async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[];
  const incident = await tenantPortalService.reportIncident(req.user!.userId, req.body, files);
  return sendSuccess(res, incident, "Incident signalé avec succès", 201);
});

export const getMyDocuments = asyncHandler(async (req: Request, res: Response) => {
  const data = await tenantPortalService.getMyDocuments(req.user!.userId);
  return sendSuccess(res, data, "Documents locataire récupérés");
});

export const uploadPaymentProof = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) throw new Error("Aucun fichier de justificatif transmis.");
  const data = await tenantPortalService.uploadPaymentProof(req.user!.userId, req.params.id, file);
  return sendSuccess(res, data, "Justificatif de paiement téléversé avec succès");
});

export const getMyNotifications = asyncHandler(async (req: Request, res: Response) => {
  const data = await tenantPortalService.getMyNotifications(req.user!.userId);
  return sendSuccess(res, data, "Notifications locataire récupérées");
});

export const markNotificationRead = asyncHandler(async (req: Request, res: Response) => {
  await tenantPortalService.markNotificationRead(req.user!.userId, req.params.id);
  return sendSuccess(res, null, "Notification marquée comme lue");
});
