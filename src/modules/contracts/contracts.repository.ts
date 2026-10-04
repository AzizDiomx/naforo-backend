import { prisma } from '@/config/database';
import { Contract, Prisma } from '@prisma/client';
import { PaginationQuery } from '@/shared/types';
import { generateContractNumber } from '@/shared/helpers/crypto';

export class ContractsRepository {
  async findAll(
    organizationId: string,
    options: PaginationQuery & { status?: string; propertyId?: string; tenantProfileId?: string }
  ): Promise<{ contracts: Contract[]; total: number }> {
    const { page, limit, search, sortBy, sortOrder, status, propertyId, tenantProfileId } = options;
    const skip = (page - 1) * limit;

    const where: Prisma.ContractWhereInput = {
      organizationId,
      status: status || undefined,
      propertyId: propertyId || undefined,
      tenantProfileId: tenantProfileId || undefined,
      OR: search
        ? [
            { contractNumber: { contains: search, mode: 'insensitive' } },
            { tenantProfile: { firstName: { contains: search, mode: 'insensitive' } } },
            { tenantProfile: { lastName: { contains: search, mode: 'insensitive' } } },
            { property: { name: { contains: search, mode: 'insensitive' } } },
          ]
        : undefined,
    };

    const [contracts, total] = await Promise.all([
      prisma.contract.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy || 'createdAt']: (sortOrder || 'ASC').toLowerCase() as 'asc' | 'desc' },
        include: {
          property: { select: { id: true, name: true, type: true, city: true, country: true, address: true } },
          tenantProfile: { select: { id: true, firstName: true, lastName: true, phone: true, email: true, reliabilityScore: true } },
          owner: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
      prisma.contract.count({ where }),
    ]);

    return { contracts, total };
  }

  async findById(id: string, organizationId: string): Promise<Contract | null> {
    return prisma.contract.findFirst({
      where: { id, organizationId },
      include: {
        property: true,
        tenantProfile: true,
        owner: true,
        invoices: { orderBy: { dueDate: 'desc' } },
        payments: { orderBy: { paymentDate: 'desc' } },
      },
    });
  }

  async findActiveByProperty(propertyId: string): Promise<Contract | null> {
    return prisma.contract.findFirst({
      where: {
        propertyId,
        status: 'active',
      },
    });
  }

  async findExpiringSoon(organizationId: string, days = 30): Promise<Contract[]> {
    const limitDate = new Date();
    limitDate.setDate(limitDate.getDate() + days);

    return prisma.contract.findMany({
      where: {
        organizationId,
        status: 'active',
        endDate: {
          gte: new Date(),
          lte: limitDate,
        },
      },
      include: {
        property: true,
        tenantProfile: true,
      },
    });
  }

  async create(data: Prisma.ContractUncheckedCreateInput): Promise<Contract> {
    // Generate unique contract number
    const contractNumber = generateContractNumber('BLW');
    
    return prisma.contract.create({
      data: {
        ...data,
        contractNumber,
      },
    });
  }

  async update(id: string, data: Prisma.ContractUpdateInput): Promise<Contract> {
    return prisma.contract.update({
      where: { id },
      data,
    });
  }

  async terminate(id: string, reason: string, terminatedAt: Date): Promise<Contract> {
    return prisma.contract.update({
      where: { id },
      data: {
        status: 'terminated',
        terminationReason: reason,
        terminatedAt,
      },
    });
  }

  async getStats(organizationId: string): Promise<any> {
    const [active, expired, terminated, draft] = await Promise.all([
      prisma.contract.count({ where: { organizationId, status: 'active' } }),
      prisma.contract.count({ where: { organizationId, status: 'expired' } }),
      prisma.contract.count({ where: { organizationId, status: 'terminated' } }),
      prisma.contract.count({ where: { organizationId, status: 'draft' } }),
    ]);

    return { active, expired, terminated, draft };
  }
}

export const contractsRepository = new ContractsRepository();
