import { Request, Response } from 'express';
import { propertiesService } from './properties.service';
import { sendSuccess, sendPaginated, asyncHandler } from '@/shared/helpers/response';
import { getPaginationParams } from '@/shared/helpers/pagination';

export const getAllProperties = asyncHandler(async (req: Request, res: Response) => {
  const queryParams = getPaginationParams(req);
  const type = req.query.type as string;
  const status = req.query.status as string;

  const result = await propertiesService.getAllProperties(
    req.organizationId!,
    { ...queryParams, type, status }
  );
  
  return sendPaginated(res, result.data, result.meta, 'Biens immobiliers récupérés avec succès.');
});

export const getPropertyById = asyncHandler(async (req: Request, res: Response) => {
  const property = await propertiesService.getPropertyById(req.params.id, req.organizationId!);
  return sendSuccess(res, property, 'Bien immobilier récupéré.');
});

export const getAvailableProperties = asyncHandler(async (req: Request, res: Response) => {
  const properties = await propertiesService.getAvailableProperties(req.organizationId!);
  return sendSuccess(res, properties, 'Biens immobiliers disponibles récupérés.');
});

export const createProperty = asyncHandler(async (req: Request, res: Response) => {
  const property = await propertiesService.createProperty(
    req.body,
    req.organizationId!,
    req.user!.userId
  );
  return sendSuccess(res, property, 'Bien immobilier créé avec succès.', 201);
});

export const updateProperty = asyncHandler(async (req: Request, res: Response) => {
  const property = await propertiesService.updateProperty(
    req.params.id,
    req.body,
    req.organizationId!
  );
  return sendSuccess(res, property, 'Bien immobilier mis à jour avec succès.');
});

export const updatePropertyStatus = asyncHandler(async (req: Request, res: Response) => {
  const property = await propertiesService.updatePropertyStatus(
    req.params.id,
    req.body.status,
    req.organizationId!
  );
  return sendSuccess(res, property, 'Statut du bien immobilier mis à jour.');
});

export const uploadPhotos = asyncHandler(async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    return sendSuccess(res, null, 'Aucune photo téléversée.');
  }

  // Map file paths relative to upload dir
  const photoUrls = files.map((f) => `/uploads/${f.filename}`);
  const property = await propertiesService.uploadPhotos(req.params.id, photoUrls, req.organizationId!);
  
  return sendSuccess(res, property, 'Photos téléversées avec succès.');
});

export const deleteProperty = asyncHandler(async (req: Request, res: Response) => {
  await propertiesService.deleteProperty(req.params.id, req.organizationId!);
  return sendSuccess(res, null, 'Bien immobilier supprimé avec succès.');
});

export const getStats = asyncHandler(async (req: Request, res: Response) => {
  const stats = await propertiesService.getStats(req.organizationId!);
  return sendSuccess(res, stats, 'Statistiques de biens récupérées.');
});
