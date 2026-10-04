import { Request, Response } from 'express';
import { documentsService } from './documents.service';
import { sendSuccess, asyncHandler } from '@/shared/helpers/response';
import { BadRequestError } from '@/shared/errors/AppError';

export const getAllDocuments = asyncHandler(async (req: Request, res: Response) => {
  const entityType = req.query.entityType as string;
  const entityId = req.query.entityId as string;

  const documents = await documentsService.getAllDocuments(req.organizationId!, entityType, entityId);
  return sendSuccess(res, documents, 'Documents récupérés avec succès.');
});

export const uploadDocument = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  const entityType = (req.body.entityType || 'general').trim();
  const entityId = (req.body.entityId || req.organizationId!).trim();

  if (!file) {
    throw new BadRequestError('Aucun document fourni.');
  }

  const document = await documentsService.uploadDocument(
    file,
    entityType,
    entityId,
    req.organizationId!,
    req.user!.userId
  );

  return sendSuccess(res, document, 'Document téléversé avec succès.', 201);
});

export const deleteDocument = asyncHandler(async (req: Request, res: Response) => {
  await documentsService.deleteDocument(req.params.id, req.organizationId!);
  return sendSuccess(res, null, 'Document supprimé avec succès.');
});
