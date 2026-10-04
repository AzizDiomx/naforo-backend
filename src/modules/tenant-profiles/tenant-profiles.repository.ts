import { prisma } from '@/config/database';
import { TenantProfile, Prisma } from '@prisma/client';
import { PaginationQuery } from '@/shared/types';

export class TenantProfilesRepository {
  async findAll(
    organizationId: string,
    options: PaginationQuery
  ): Promise<{ tenantProfiles: TenantProfile[]; total: number }> {
    const { page, limit, search, sortBy, sortOrder } = options;
    const skip = (page - 1) * limit;

    const where: Prisma.TenantProfileWhereInput = {
      organizationId,
      isActive: true,
      OR: search
        ? [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
          ]
        : undefined,
    };

    const [tenantProfiles, total] = await Promise.all([
      prisma.tenantProfile.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy || 'createdAt']: (sortOrder || 'ASC').toLowerCase() as 'asc' | 'desc' },
        include: {
          contracts: {
            where: { status: 'active' },
            select: {
              id: true,
              contractNumber: true,
              rentAmount: true,
              chargesAmount: true,
              property: {
                select: {
                  id: true,
                  name: true,
                  type: true,
                  city: true,
                  country: true,
                  address: true,
                },
              },
            },
          },
        },
      }),
      prisma.tenantProfile.count({ where }),
    ]);

    return { tenantProfiles, total };
  }

  async findById(id: string, organizationId: string): Promise<TenantProfile | null> {
    return prisma.tenantProfile.findFirst({
      where: { id, organizationId },
      include: {
        user: { select: { email: true, isActive: true } },
        contracts: {
          orderBy: { startDate: 'desc' },
          include: { property: true },
        },
      },
    });
  }

  async findByUserId(userId: string): Promise<TenantProfile | null> {
    return prisma.tenantProfile.findUnique({
      where: { userId },
      include: { organization: true },
    });
  }

  async create(data: Prisma.TenantProfileUncheckedCreateInput): Promise<TenantProfile> {
    return prisma.tenantProfile.create({
      data,
    });
  }

  async update(id: string, data: Prisma.TenantProfileUpdateInput): Promise<TenantProfile> {
    return prisma.tenantProfile.update({
      where: { id },
      data,
    });
  }

  async softDelete(id: string): Promise<TenantProfile> {
    return prisma.tenantProfile.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async updateReliabilityScore(id: string, reliabilityScore: number): Promise<TenantProfile> {
    return prisma.tenantProfile.update({
      where: { id },
      data: { reliabilityScore },
    });
  }

  async getHistory(id: string, organizationId: string): Promise<any> {
    const [contracts, payments, receipts, incidents] = await Promise.all([
      prisma.contract.findMany({
        where: { tenantProfileId: id, organizationId },
        orderBy: { startDate: 'desc' },
        include: { property: true },
      }),
      prisma.payment.findMany({
        where: { tenantProfileId: id, organizationId },
        orderBy: { paymentDate: 'desc' },
        include: { invoice: true },
      }),
      prisma.receipt.findMany({
        where: { tenantProfileId: id, organizationId },
        orderBy: { issuedAt: 'desc' },
        include: { property: true },
      }),
      prisma.incident.findMany({
        where: { tenantProfileId: id, organizationId },
        orderBy: { createdAt: 'desc' },
        include: { property: true },
      }),
    ]);

    return { contracts, payments, receipts, incidents };
  }
}

export const tenantProfilesRepository = new TenantProfilesRepository();
