import { incidentsRepository } from './incidents.repository';
import { prisma } from '@/config/database';
import { NotFoundError, BadRequestError } from '@/shared/errors/AppError';
import { Incident } from '@prisma/client';
import { emitToOrg } from '@/sockets/socket.handler';
import { PaginationQuery, PaginationMeta } from '@/shared/types';
import { buildPaginationMeta } from '@/shared/helpers/pagination';
import { dispatchNotification } from '@/shared/helpers/notification';

let notificationsService: any;
import('@/modules/notifications/notifications.service').then((m) => {
  notificationsService = m.notificationsService;
});

export class IncidentsService {
  async getAllIncidents(
    organizationId: string,
    query: PaginationQuery & { status?: string; type?: string; priority?: string; propertyId?: string }
  ): Promise<{ data: Incident[]; meta: PaginationMeta }> {
    const { incidents, total } = await incidentsRepository.findAll(organizationId, query);
    const meta = buildPaginationMeta(total, query.page, query.limit);
    return { data: incidents, meta };
  }

  async getIncidentById(id: string, organizationId: string): Promise<Incident> {
    const incident = await incidentsRepository.findById(id, organizationId);
    if (!incident) {
      throw new NotFoundError('Signalement d\'incident introuvable.');
    }
    return incident;
  }

  async createIncident(data: any, tenantProfileId: string, organizationId: string, isTenant: boolean = false): Promise<Incident> {
    // 1. Verify property belongs to organization
    const property = await prisma.property.findFirst({
      where: { id: data.propertyId, organizationId },
    });

    if (!property) {
      throw new NotFoundError('Bien immobilier introuvable.');
    }

    // 2. If declared directly by a tenant, verify active contract
    if (isTenant) {
      const activeContract = await prisma.contract.findFirst({
        where: { propertyId: data.propertyId, tenantProfileId, status: 'active' },
      });

      if (!activeContract) {
        throw new BadRequestError('Vous ne pouvez signaler des incidents que sur les logements où vous possédez un bail actif.', [
          { field: 'propertyId', message: 'Aucun bail actif ne vous associe à ce logement.' }
        ]);
      }
    }

    const tenant = await prisma.tenantProfile.findUnique({
      where: { id: tenantProfileId },
    });

    if (!tenant) {
      throw new NotFoundError('Profil locataire introuvable.');
    }

    const incident = await incidentsRepository.create({
      propertyId: data.propertyId,
      type: data.type,
      title: data.title,
      description: data.description || null,
      priority: data.priority || 'medium',
      photos: Array.isArray(data.photos) ? data.photos : [],
      tenantProfileId,
      organizationId,
      status: 'open',
    });

    // Notify organization
    emitToOrg(organizationId, 'incident:created', incident);

    const tenantName = `${tenant.firstName} ${tenant.lastName}`;

    // 1. Notify Landlord / Organization
    try {
      await dispatchNotification({
        organizationId,
        type: 'INCIDENT_REPORTED',
        title: '⚠️ Signalement de panne / incident',
        emailSubject: `[Naforo] Incident signalé par ${tenantName} - ${incident.title}`,
        emailHtml: `
          <div style="font-family: Arial, sans-serif; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #dc2626;">Nouvel incident répertorié</h2>
            <p>Le locataire <strong>${tenantName}</strong> a signalé un problème sur le bien <strong>${property.name}</strong>.</p>
            <p><strong>Titre :</strong> ${incident.title}</p>
            <p><strong>Type :</strong> ${incident.type.toUpperCase()}</p>
            <p><strong>Priorité :</strong> ${incident.priority.toUpperCase()}</p>
            <p><strong>Description :</strong> ${incident.description || 'Non renseignée'}</p>
            <p style="margin-top: 20px;">Connectez-vous à votre Backoffice pour assigner un technicien ou résoudre l'incident.</p>
          </div>
        `,
        smsText: `Naforo: Le locataire ${tenantName} a signalé une panne "${incident.title}" sur ${property.name}. Priorité: ${incident.priority.toUpperCase()}.`,
        data: { incidentId: incident.id },
      });
    } catch (e) {}

    // 2. Notify Tenant (Confirmation)
    try {
      await dispatchNotification({
        userId: tenant.userId || undefined,
        email: tenant.email,
        phone: tenant.phone,
        type: 'INCIDENT_REPORTED_CONFIRMATION',
        title: '✅ Signalement d\'incident transmis',
        emailSubject: `[Naforo] Prise en compte de votre signalement "${incident.title}"`,
        emailHtml: `
          <div style="font-family: Arial, sans-serif; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #2563eb;">Signalement enregistré</h2>
            <p>Bonjour <strong>${tenantName}</strong>,</p>
            <p>Votre déclaration d'incident <strong>"${incident.title}"</strong> a bien été enregistrée et transmise à votre propriétaire.</p>
            <p>Vous recevrez une alerte dès qu'un technicien sera pris en charge ou que l'incident sera résolu.</p>
          </div>
        `,
        smsText: `Naforo: Votre déclaration d'incident "${incident.title}" a bien été transmise à votre propriétaire.`,
        data: { incidentId: incident.id },
      });
    } catch (e) {}

    return incident;
  }

  async updateIncident(id: string, data: any, organizationId: string): Promise<Incident> {
    await this.getIncidentById(id, organizationId);
    return incidentsRepository.update(id, data);
  }

  async updateIncidentStatus(id: string, data: any, organizationId: string): Promise<Incident> {
    const incident = await this.getIncidentById(id, organizationId);

    const updated = await incidentsRepository.update(id, {
      status: data.status,
      resolutionNotes: data.resolutionNotes || incident.resolutionNotes,
      resolvedAt: data.status === 'resolved' ? new Date() : incident.resolvedAt,
    });

    emitToOrg(organizationId, 'incident:updated', updated);

    // Fetch tenant details
    const tenantProfile = await prisma.tenantProfile.findUnique({
      where: { id: incident.tenantProfileId },
      include: { user: true },
    });

    const statusText = data.status === 'resolved' ? 'Résolu' : data.status === 'in_progress' ? 'Pris en charge' : data.status;
    const notes = data.resolutionNotes ? `Note: ${data.resolutionNotes}` : '';

    // 1. Notify Tenant
    if (tenantProfile) {
      try {
        await dispatchNotification({
          userId: tenantProfile.userId || undefined,
          email: tenantProfile.email || tenantProfile.user?.email,
          phone: tenantProfile.phone,
          type: 'INCIDENT_STATUS_UPDATED',
          title: `🔧 Incidents : Statut ${statusText}`,
          emailSubject: `[Naforo] Mise à jour de votre incident "${incident.title}"`,
          emailHtml: `
            <div style="font-family: Arial, sans-serif; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #2563eb;">Suivi de votre signalement</h2>
              <p>Votre signalement <strong>"${incident.title}"</strong> (Réf: ${incident.incidentNumber}) est désormais marqué comme <strong>${statusText}</strong>.</p>
              ${data.resolutionNotes ? `<p><strong>Commentaire du gestionnaire :</strong> ${data.resolutionNotes}</p>` : ''}
              <p style="margin-top: 20px;">Merci pour votre confiance sur Naforo.</p>
            </div>
          `,
          smsText: `Naforo: Votre signalement "${incident.title}" est désormais marqué comme ${statusText}. ${notes}`,
          data: { incidentId: incident.id },
        });
      } catch (e) {}
    }

    // 2. Notify Landlord Confirmation
    try {
      await dispatchNotification({
        organizationId,
        type: 'INCIDENT_STATUS_CONFIRMATION',
        title: `✅ Incidents : Statut ${statusText}`,
        emailSubject: `[Naforo] Clôture / Mise à jour de l'incident "${incident.title}"`,
        emailHtml: `
          <div style="font-family: Arial, sans-serif; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #16a34a;">Traitement d'incident confirmé</h2>
            <p>Le ticket N° <strong>${incident.incidentNumber}</strong> ("${incident.title}") a été mis à jour avec le statut <strong>${statusText}</strong>.</p>
          </div>
        `,
        smsText: `Naforo: Le ticket ${incident.incidentNumber} ("${incident.title}") a été mis à jour vers ${statusText}.`,
        data: { incidentId: incident.id },
      });
    } catch (e) {}

    return updated;
  }

  async assignIncident(id: string, technicianId: string, organizationId: string): Promise<Incident> {
    await this.getIncidentById(id, organizationId);

    // Check technician existence
    const tech = await prisma.user.findFirst({
      where: { 
        id: technicianId, 
        organizationId, 
        role: { in: ['technician', 'manager', 'admin'] }, 
        isActive: true 
      },
    });

    if (!tech) {
      throw new NotFoundError('Intervenant ou technicien introuvable dans votre organisation.');
    }

    const incident = await incidentsRepository.update(id, {
      assignedTo: technicianId,
      status: 'in_progress',
    });

    emitToOrg(organizationId, 'incident:assigned', incident);

    // Notify technician
    if (notificationsService) {
      notificationsService.notify({
        organizationId,
        userId: technicianId,
        type: 'INCIDENT_ASSIGNED',
        title: 'Nouvel incident assigné',
        message: `On vous a assigné la résolution du ticket ${incident.incidentNumber} : "${incident.title}".`,
        channels: ['push', 'email'],
      }).catch(console.error);
    }

    return incident;
  }

  async resolveIncident(id: string, data: any, organizationId: string): Promise<Incident> {
    const incident = await this.getIncidentById(id, organizationId);

    if (incident.status === 'resolved' || incident.status === 'closed') {
      throw new BadRequestError('Cet incident est déjà résolu ou clôturé.');
    }

    const updatedIncident = await incidentsRepository.update(id, {
      status: 'resolved',
      resolutionNotes: data.resolutionNotes,
      resolvedAt: data.resolvedAt || new Date(),
    });

    emitToOrg(organizationId, 'incident:resolved', updatedIncident);

    // Notify tenant
    if (notificationsService) {
      const tenantUser = await prisma.user.findFirst({
        where: { tenantProfile: { id: incident.tenantProfileId } },
      });
      if (tenantUser) {
        notificationsService.notify({
          organizationId,
          userId: tenantUser.id,
          type: 'INCIDENT_RESOLVED',
          title: 'Incident Résolu !',
          message: `Le ticket N° ${incident.incidentNumber} concernant "${incident.title}" a été résolu. Résolution : ${data.resolutionNotes}`,
          channels: ['push', 'email'],
        }).catch(console.error);
      }
    }

    return updatedIncident;
  }

  async uploadPhotos(id: string, photoUrls: string[], organizationId: string): Promise<Incident> {
    const incident = await this.getIncidentById(id, organizationId);
    const currentPhotos = (incident.photos as string[]) || [];
    const updatedPhotos = [...currentPhotos, ...photoUrls];

    return incidentsRepository.update(id, { photos: updatedPhotos });
  }

  async getStats(organizationId: string): Promise<any> {
    return incidentsRepository.getStats(organizationId);
  }
}

export const incidentsService = new IncidentsService();


