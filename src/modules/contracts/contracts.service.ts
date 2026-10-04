import { contractsRepository } from './contracts.repository';
import { prisma } from '@/config/database';
import { NotFoundError, BadRequestError } from '@/shared/errors/AppError';
import { Contract } from '@prisma/client';
import { emitToOrg } from '@/sockets/socket.handler';
import { PaginationQuery, PaginationMeta } from '@/shared/types';
import { buildPaginationMeta } from '@/shared/helpers/pagination';
import { generateContractNumber } from '@/shared/helpers/crypto';

export class ContractsService {
  async getAllContracts(
    organizationId: string,
    query: PaginationQuery & { status?: string; propertyId?: string; tenantProfileId?: string }
  ): Promise<{ data: Contract[]; meta: PaginationMeta }> {
    const { contracts, total } = await contractsRepository.findAll(organizationId, query);
    const meta = buildPaginationMeta(total, query.page, query.limit);
    return { data: contracts, meta };
  }

  async getContractById(id: string, organizationId: string): Promise<Contract> {
    const contract = await contractsRepository.findById(id, organizationId);
    if (!contract) {
      throw new NotFoundError('Contrat de bail introuvable.');
    }
    return contract;
  }

  async createContract(data: any, organizationId: string, createdBy: string): Promise<Contract> {
    // 1. Verify property availability
    const property = await prisma.property.findFirst({
      where: { id: data.propertyId, organizationId },
    });

    if (!property) {
      throw new NotFoundError('Bien immobilier introuvable.');
    }

    if (property.status !== 'available') {
      throw new BadRequestError('Ce bien immobilier n\'est pas disponible pour une nouvelle location.', [
        { field: 'propertyId', message: 'Ce bien immobilier est actuellement indisponible ou déjà occupé.' },
      ]);
    }

    // Verify no existing active contract on this property
    const existingActive = await prisma.contract.findFirst({
      where: { propertyId: data.propertyId, status: 'active' },
    });
    if (existingActive) {
      throw new BadRequestError('Un contrat de bail actif est déjà en cours sur ce bien immobilier.', [
        { field: 'propertyId', message: 'Un contrat de bail actif est déjà en cours sur ce bien.' },
      ]);
    }

    // 2. Verify tenant profile
    const tenant = await prisma.tenantProfile.findFirst({
      where: { id: data.tenantProfileId, organizationId, isActive: true },
    });

    if (!tenant) {
      throw new NotFoundError('Profil locataire introuvable.');
    }

    // Date consistency check
    if (data.endDate && new Date(data.endDate) <= new Date(data.startDate)) {
      throw new BadRequestError('La date de fin de bail doit être postérieure à la date de début.', [
        { field: 'endDate', message: 'La date de fin de bail doit être postérieure à la date de début.' },
      ]);
    }

    const contractNumber = generateContractNumber('BLW');

    // 3. Validation de conformité juridique (Loi n° 2019-576 : caution <= 2 mois de loyer)
    const deposit = data.depositAmount || data.cautionAmount || 0;
    if (deposit > 2 * data.rentAmount) {
      throw new BadRequestError(
        `Conformément à la réglementation sur les baux d'habitation (Loi n° 2019-576), le dépôt de garantie (${deposit.toLocaleString()} FCFA) ne peut pas excéder 2 mois de loyer hors charges (${(2 * data.rentAmount).toLocaleString()} FCFA max).`,
        [{ field: 'depositAmount', message: 'Le dépôt de garantie ne peut pas excéder 2 mois de loyer hors charges (Loi n° 2019-576).' }]
      );
    }

    // Execute in transaction
    const contract = await prisma.$transaction(async (tx) => {
      // Create contract
      const newContract = await tx.contract.create({
        data: {
          ...data,
          contractNumber,
          organizationId,
          createdBy,
          rentAmount: data.rentAmount,
          chargesAmount: data.chargesAmount,
          depositAmount: data.depositAmount,
          cautionAmount: data.cautionAmount,
        },
      });

      // Update property status to occupied
      await tx.property.update({
        where: { id: data.propertyId },
        data: { status: 'occupied' },
      });

      return newContract;
    });

    // Notify organization staff
    emitToOrg(organizationId, 'contract:created', contract);

    return contract;
  }

  async updateContract(id: string, data: any, organizationId: string): Promise<Contract> {
    await this.getContractById(id, organizationId);
    return contractsRepository.update(id, data);
  }

  async terminateContract(id: string, data: any, organizationId: string): Promise<Contract> {
    const contract = await this.getContractById(id, organizationId);
    
    if (contract.status === 'terminated') {
      throw new BadRequestError('Ce contrat de bail est déjà résilié.');
    }

    const updatedContract = await prisma.$transaction(async (tx) => {
      // 1. Terminate contract
      const c = await tx.contract.update({
        where: { id },
        data: {
          status: 'terminated',
          terminationReason: data.terminationReason,
          terminatedAt: data.terminatedAt || new Date(),
        },
      });

      // 2. Set property status back to available
      await tx.property.update({
        where: { id: contract.propertyId },
        data: { status: 'available' },
      });

      return c;
    });

    emitToOrg(organizationId, 'contract:terminated', updatedContract);

    return updatedContract;
  }

  async getExpiringContracts(organizationId: string, days = 30): Promise<Contract[]> {
    return contractsRepository.findExpiringSoon(organizationId, days);
  }

  async getStats(organizationId: string): Promise<any> {
    return contractsRepository.getStats(organizationId);
  }
}

export const contractsService = new ContractsService();
