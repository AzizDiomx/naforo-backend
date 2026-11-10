import { Request, Response } from 'express';
import { inspectionsService } from './inspections.service';
import { sendSuccess, sendPaginated, asyncHandler } from '@/shared/helpers/response';
import { getPaginationParams } from '@/shared/helpers/pagination';
import { BadRequestError } from '@/shared/errors/AppError';

export const getAllInspections = asyncHandler(async (req: Request, res: Response) => {
  const queryParams = getPaginationParams(req);
  const type = req.query.type as string;
  const status = req.query.status as string;
  const propertyId = req.query.propertyId as string;
  const contractId = req.query.contractId as string;
  const tenantProfileId = req.query.tenantProfileId as string;
  const search = req.query.search as string;

  const result = await inspectionsService.getAllInspections(
    req.organizationId!,
    { ...queryParams, type, status, propertyId, contractId, tenantProfileId, search }
  );

  return sendPaginated(res, result.data, result.meta, 'États des lieux récupérés avec succès.');
});

export const getInspectionById = asyncHandler(async (req: Request, res: Response) => {
  const inspection = await inspectionsService.getInspectionById(req.params.id, req.organizationId!);
  return sendSuccess(res, inspection, 'État des lieux récupéré.');
});

export const createInspection = asyncHandler(async (req: Request, res: Response) => {
  const inspection = await inspectionsService.createInspection(
    req.body,
    req.organizationId!,
    req.user?.userId
  );
  return sendSuccess(res, inspection, "État des lieux initialisé avec succès.", 201);
});

export const updateInspection = asyncHandler(async (req: Request, res: Response) => {
  const inspection = await inspectionsService.updateInspection(
    req.params.id,
    req.body,
    req.organizationId!
  );
  return sendSuccess(res, inspection, "État des lieux mis à jour.");
});

export const signInspection = asyncHandler(async (req: Request, res: Response) => {
  const { signerRole, signature } = req.body;
  const inspection = await inspectionsService.signInspection(
    req.params.id,
    req.organizationId!,
    signerRole,
    signature
  );
  return sendSuccess(res, inspection, 'Signature apposée avec succès sur le constat.');
});

export const compareInspections = asyncHandler(async (req: Request, res: Response) => {
  const contractId = req.params.contractId || (req.query.contractId as string);
  if (!contractId) {
    throw new BadRequestError('Identifiant du contrat de bail obligatoire pour la comparaison.');
  }

  const comparison = await inspectionsService.compareInspections(contractId, req.organizationId!);
  return sendSuccess(res, comparison, 'Comparatif Entrée / Sortie généré avec succès.');
});

export const uploadPhoto = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    throw new BadRequestError('Aucun fichier photo fourni.');
  }

  const photoUrl = `/uploads/${file.filename}`;
  return sendSuccess(res, { photoUrl }, 'Photo constatée enregistrée avec succès.');
});

export const deleteInspection = asyncHandler(async (req: Request, res: Response) => {
  await inspectionsService.deleteInspection(req.params.id, req.organizationId!);
  return sendSuccess(res, null, "État des lieux supprimé.");
});
