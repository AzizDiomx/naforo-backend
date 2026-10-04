import { Request, Response } from 'express';
import { incidentsService } from './incidents.service';
import { sendSuccess, sendPaginated, asyncHandler } from '@/shared/helpers/response';
import { getPaginationParams } from '@/shared/helpers/pagination';
import { prisma } from '@/config/database';
import { ForbiddenError, NotFoundError } from '@/shared/errors/AppError';

export const getAllIncidents = asyncHandler(async (req: Request, res: Response) => {
  const queryParams = getPaginationParams(req);
  const status = req.query.status as string;
  const type = req.query.type as string;
  const priority = req.query.priority as string;
  const propertyId = req.query.propertyId as string;

  const result = await incidentsService.getAllIncidents(
    req.organizationId!,
    { ...queryParams, status, type, priority, propertyId }
  );

  return sendPaginated(res, result.data, result.meta, 'Signalements d\'incidents récupérés.');
});

export const getIncidentById = asyncHandler(async (req: Request, res: Response) => {
  const incident = await incidentsService.getIncidentById(req.params.id, req.organizationId!);

  // Access check: tenant can only view their own incidents
  if (req.user!.role === 'tenant') {
    const profile = await prisma.tenantProfile.findUnique({
      where: { userId: req.user!.userId },
    });
    if (!profile || incident.tenantProfileId !== profile.id) {
      throw new ForbiddenError('Accès interdit : Cet incident ne vous concerne pas.');
    }
  }

  return sendSuccess(res, incident, 'Incident récupéré.');
});

export const createIncident = asyncHandler(async (req: Request, res: Response) => {
  let tenantProfileId = req.body.tenantProfileId;

  if (req.user!.role === 'tenant') {
    const profile = await prisma.tenantProfile.findUnique({
      where: { userId: req.user!.userId },
    });
    if (!profile) {
      throw new NotFoundError('Profil locataire introuvable pour votre compte.');
    }
    tenantProfileId = profile.id;
  } else if (!tenantProfileId) {
    // If not specified by manager, find active contract on this property
    const activeContract = await prisma.contract.findFirst({
      where: { propertyId: req.body.propertyId, organizationId: req.organizationId!, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
    if (activeContract) {
      tenantProfileId = activeContract.tenantProfileId;
    } else {
      // Find latest contract on this property
      const anyContract = await prisma.contract.findFirst({
        where: { propertyId: req.body.propertyId, organizationId: req.organizationId! },
        orderBy: { createdAt: 'desc' },
      });
      if (anyContract) {
        tenantProfileId = anyContract.tenantProfileId;
      }
    }

    // If still not found, fallback to any tenant profile in the org
    if (!tenantProfileId) {
      const anyTenant = await prisma.tenantProfile.findFirst({
        where: { organizationId: req.organizationId! },
        orderBy: { createdAt: 'desc' },
      });
      if (anyTenant) {
        tenantProfileId = anyTenant.id;
      } else {
        throw new ForbiddenError('Veuillez d\'abord ajouter un locataire dans l\'organisation avant de déclarer un incident.');
      }
    }
  }

  const incident = await incidentsService.createIncident(
    req.body,
    tenantProfileId,
    req.organizationId!,
    req.user!.role === 'tenant'
  );

  return sendSuccess(res, incident, 'Incident signalé avec succès.', 201);
});

export const updateIncident = asyncHandler(async (req: Request, res: Response) => {
  const incident = await incidentsService.updateIncident(
    req.params.id,
    req.body,
    req.organizationId!
  );
  return sendSuccess(res, incident, 'Incident mis à jour.');
});

export const updateIncidentStatus = asyncHandler(async (req: Request, res: Response) => {
  const incident = await incidentsService.updateIncidentStatus(
    req.params.id,
    req.body,
    req.organizationId!
  );
  return sendSuccess(res, incident, 'Statut de l\'incident mis à jour avec succès.');
});

export const assignIncident = asyncHandler(async (req: Request, res: Response) => {
  const incident = await incidentsService.assignIncident(
    req.params.id,
    req.body.assignedTo,
    req.organizationId!
  );
  return sendSuccess(res, incident, 'Incident assigné avec succès.');
});

export const resolveIncident = asyncHandler(async (req: Request, res: Response) => {
  const incident = await incidentsService.resolveIncident(
    req.params.id,
    req.body,
    req.organizationId!
  );
  return sendSuccess(res, incident, 'Incident résolu avec succès.');
});

export const uploadPhotos = asyncHandler(async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    return sendSuccess(res, null, 'Aucune photo fournie.');
  }

  const photoUrls = files.map((f) => `/uploads/${f.filename}`);
  const incident = await incidentsService.uploadPhotos(req.params.id, photoUrls, req.organizationId!);
  return sendSuccess(res, incident, 'Photos de l\'incident ajoutées.');
});

export const getStats = asyncHandler(async (req: Request, res: Response) => {
  const stats = await incidentsService.getStats(req.organizationId!);
  return sendSuccess(res, stats, 'Statistiques des incidents récupérées.');
});
