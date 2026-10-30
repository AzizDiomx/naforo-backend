import { propertiesRepository } from './properties.repository';
import { prisma } from '@/config/database';
import { NotFoundError, BadRequestError, ConflictError } from '@/shared/errors/AppError';
import { Property } from '@prisma/client';
import { PaginationQuery, PaginationMeta } from '@/shared/types';
import { buildPaginationMeta } from '@/shared/helpers/pagination';
import { getOrganizationPlanContext, isLotType, LOT_PROPERTY_TYPES } from '@/shared/helpers/plan-policy';

export class PropertiesService {
  async getAllProperties(
    organizationId: string,
    query: PaginationQuery & { type?: string; status?: string; managerId?: string },
    user?: { role: string; userId: string }
  ): Promise<{ data: Property[]; meta: PaginationMeta }> {
    const { properties, total } = await propertiesRepository.findAll(organizationId, query, user);
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

  /**
   * Contrôle le quota du forfait en distinguant LOTS (immeubles/résidences/ensembles)
   * et BIENS (unités locatives). Chaque catégorie possède sa propre limite.
   */
  private async assertQuota(organizationId: string, type: string, excludePropertyId?: string): Promise<void> {
    const { plan } = await getOrganizationPlanContext(organizationId);
    if (!plan) return;

    const lot = isLotType(type);
    const used = await prisma.property.count({
      where: {
        organizationId,
        ...(excludePropertyId ? { id: { not: excludePropertyId } } : {}),
        type: lot ? { in: [...LOT_PROPERTY_TYPES] } : { notIn: [...LOT_PROPERTY_TYPES] },
      },
    });
    const max = lot ? plan.maxLots : plan.maxProperties;

    if (used >= max) {
      throw new BadRequestError(
        lot
          ? `Vous avez atteint la limite de lots autorisée par votre forfait ${plan.name} (${used}/${max} lots). Veuillez surclasser votre abonnement pour créer de nouveaux lots.`
          : `Vous avez atteint la limite de biens autorisée par votre forfait ${plan.name} (${used}/${max} biens). Veuillez surclasser votre abonnement.`,
        [{ field: 'type', message: lot ? `Quota de lots atteint (${used}/${max}).` : `Quota de biens atteint (${used}/${max}).` }]
      );
    }
  }

  /** Valide la cohérence lot / bien : un bien se rattache à un lot, un lot ne s'imbrique pas. */
  private async assertHierarchy(type: string, parentId: string | null | undefined, organizationId: string, selfId?: string): Promise<void> {
    if (!parentId) return;

    if (selfId && parentId === selfId) {
      throw new BadRequestError('Un bien ne peut pas être son propre parent.');
    }

    const parent = await propertiesRepository.findById(parentId, organizationId);
    if (!parent) {
      throw new BadRequestError('Le lot parent spécifié est invalide ou n\'appartient pas à votre organisation.');
    }

    if (isLotType(type)) {
      throw new BadRequestError('Un lot ne peut pas être rattaché à un autre lot. Seuls les biens (appartements, villas, boutiques...) se rattachent à un lot.', [
        { field: 'parentId', message: 'Un lot ne peut pas être imbriqué dans un autre lot.' },
      ]);
    }

    if (!isLotType((parent as any).type) && !(parent as any).children?.length) {
      throw new BadRequestError('Le parent sélectionné n\'est pas un lot. Créez d\'abord un lot (immeuble, résidence, ensemble) pour y rattacher vos biens.', [
        { field: 'parentId', message: 'Le parent doit être un lot (immeuble, résidence ou ensemble).' },
      ]);
    }
  }

  async createProperty(data: any, organizationId: string, createdBy: string): Promise<Property> {
    // 1. Contrôle du quota d'abonnement (lots et biens distincts)
    await this.assertQuota(organizationId, data.type);

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

    // Vérifier la cohérence lot / bien du parent
    await this.assertHierarchy(data.type, data.parentId, organizationId);

    return propertiesRepository.create({
      ...data,
      name: normalizedName || data.name,
      organizationId,
      createdBy,
    });
  }

  async updateProperty(id: string, data: any, organizationId: string): Promise<Property> {
    const existing: any = await this.getPropertyById(id, organizationId);

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

    // Changement de catégorie (bien <-> lot) : contrôle des quotas et de la cohérence de la hiérarchie
    const targetType: string = data.type ?? existing.type;
    const targetParentId: string | null | undefined = data.parentId !== undefined ? data.parentId : existing.parentId;
    const categoryChanged = isLotType(targetType) !== isLotType(existing.type);

    if (categoryChanged) {
      await this.assertQuota(organizationId, targetType, id);

      if (!isLotType(targetType) && existing.children?.length > 0) {
        throw new BadRequestError('Ce lot contient des biens. Détachez ou déplacez ses biens avant de le convertir en bien individuel.');
      }

      if (isLotType(targetType)) {
        const activeContracts = await prisma.contract.count({ where: { propertyId: id, status: 'active' } });
        if (activeContracts > 0) {
          throw new BadRequestError('Ce bien est actuellement loué (bail actif) : il ne peut pas être converti en lot.');
        }
      }
    }

    await this.assertHierarchy(targetType, targetParentId, organizationId, id);

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

  async getLots(organizationId: string, user?: { role: string; userId: string }): Promise<any[]> {
    return propertiesRepository.findLots(organizationId, user);
  }

  async getAdvancedLotStatistics(organizationId: string, lotId?: string): Promise<any> {
    return propertiesRepository.getAdvancedLotStatistics(organizationId, lotId);
  }

  async getStats(organizationId: string): Promise<any> {
    return propertiesRepository.getStats(organizationId);
  }
}

export const propertiesService = new PropertiesService();
