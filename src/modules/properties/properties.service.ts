import { propertiesRepository } from './properties.repository';
import { prisma } from '@/config/database';
import { NotFoundError, BadRequestError, ConflictError } from '@/shared/errors/AppError';
import { Property } from '@prisma/client';
import { PaginationQuery, PaginationMeta } from '@/shared/types';
import { buildPaginationMeta } from '@/shared/helpers/pagination';

export class PropertiesService {
  async getAllProperties(
    organizationId: string,
    query: PaginationQuery & { type?: string; status?: string }
  ): Promise<{ data: Property[]; meta: PaginationMeta }> {
    const { properties, total } = await propertiesRepository.findAll(organizationId, query);
    const meta = buildPaginationMeta(total, query.page, query.limit);
    return { data: properties, meta };
  }

  async getPropertyById(id: string, organizationId: string): Promise<Property> {
    const property = await propertiesRepository.findById(id, organizationId);
    if (!property) {
      throw new NotFoundError('Bien immobilier introuvable.');
    }
    return property;
  }

  async getAvailableProperties(organizationId: string): Promise<Property[]> {
    return propertiesRepository.findAvailable(organizationId);
  }

  async createProperty(data: any, organizationId: string, createdBy: string): Promise<Property> {
    // 1. Contrôle du quota d'abonnement
    let activeSub = await prisma.subscription.findFirst({
      where: { organizationId },
      include: { plan: true },
      orderBy: { endDate: 'desc' },
    });

    let plan = activeSub?.plan;
    if (!plan) {
      plan = await prisma.subscriptionPlan.findUnique({ where: { code: 'starter' } }) || undefined;
    }

    if (plan) {
      const propertyCount = await prisma.property.count({ where: { organizationId } });
      if (propertyCount >= plan.maxProperties) {
        throw new BadRequestError(
          `Vous avez atteint la limite de biens autorisée par votre forfait (${propertyCount}/${plan.maxProperties} biens). Veuillez surclasser votre abonnement.`
        );
      }
    }

    // 2. Unicité stricte du libellé par organisation (Formule A)
    const normalizedName = String(data.name || '').trim();
    if (normalizedName) {
      const existingProperty = await prisma.property.findFirst({
        where: {
          organizationId,
          name: {
            equals: normalizedName,
            mode: 'insensitive',
          },
        },
      });

      if (existingProperty) {
        throw new ConflictError('Un bien portant ce libellé existe déjà dans votre patrimoine.', [
          { field: 'name', message: 'Un bien portant ce libellé existe déjà dans votre patrimoine.' },
        ]);
      }
    }

    // If parentId provided, verify it exists and belongs to the same org
    if (data.parentId) {
      const parent = await propertiesRepository.findById(data.parentId, organizationId);
      if (!parent) {
        throw new BadRequestError('Le bien parent spécifié est invalide ou n\'appartient pas à votre organisation.');
      }
    }

    return propertiesRepository.create({
      ...data,
      name: normalizedName || data.name,
      organizationId,
      createdBy,
    });
  }

  async updateProperty(id: string, data: any, organizationId: string): Promise<Property> {
    await this.getPropertyById(id, organizationId);

    // Unicité stricte du libellé par organisation lors de la modification (Formule A)
    if (data.name) {
      const normalizedName = String(data.name).trim();
      const existingProperty = await prisma.property.findFirst({
        where: {
          organizationId,
          id: { not: id },
          name: {
            equals: normalizedName,
            mode: 'insensitive',
          },
        },
      });

      if (existingProperty) {
        throw new ConflictError('Un bien portant ce libellé existe déjà dans votre patrimoine.', [
          { field: 'name', message: 'Un bien portant ce libellé existe déjà dans votre patrimoine.' },
        ]);
      }
      data.name = normalizedName;
    }

    if (data.parentId) {
      const parent = await propertiesRepository.findById(data.parentId, organizationId);
      if (!parent) {
        throw new BadRequestError('Le bien parent spécifié est invalide.');
      }
    }

    return propertiesRepository.update(id, data);
  }

  async updatePropertyStatus(id: string, status: string, organizationId: string): Promise<Property> {
    await this.getPropertyById(id, organizationId);
    return propertiesRepository.update(id, { status });
  }

  async uploadPhotos(id: string, photoUrls: string[], organizationId: string): Promise<Property> {
    const property = await this.getPropertyById(id, organizationId);
    
    // Merge new photos with existing ones
    const currentPhotos = (property.photos as string[]) || [];
    const updatedPhotos = [...currentPhotos, ...photoUrls];

    return propertiesRepository.update(id, { photos: updatedPhotos });
  }

  async deleteProperty(id: string, organizationId: string): Promise<void> {
    const property = await this.getPropertyById(id, organizationId);

    // Verify no active contract is bound to this property
    const activeContractsCount = await prisma.contract.count({
      where: { propertyId: id, status: 'active' },
    });
    if (activeContractsCount > 0) {
      throw new BadRequestError('Impossible de supprimer ce bien car un contrat de bail y est actuellement rattaché.');
    }

    await propertiesRepository.delete(id);
  }

  async getStats(organizationId: string): Promise<any> {
    return propertiesRepository.getStats(organizationId);
  }
}

export const propertiesService = new PropertiesService();
