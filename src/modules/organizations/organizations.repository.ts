import { prisma } from '@/config/database';
import { Organization, Prisma } from '@prisma/client';
import { PaginationQuery } from '@/shared/types';

export class OrganizationsRepository {
  async findAll(options: PaginationQuery): Promise<{ organizations: Organization[]; total: number }> {
    const { page, limit, search, sortBy, sortOrder } = options;
    const skip = (page - 1) * limit;

    const where: Prisma.OrganizationWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [organizations, total] = await Promise.all([
      prisma.organization.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy || 'createdAt']: (sortOrder || 'ASC').toLowerCase() as 'asc' | 'desc' },
      }),
      prisma.organization.count({ where }),
    ]);

    return { organizations, total };
  }

  async findById(id: string): Promise<Organization | null> {
    return prisma.organization.findUnique({
      where: { id },
    });
  }

  async create(data: Prisma.OrganizationCreateInput): Promise<Organization> {
    return prisma.organization.create({
      data,
    });
  }

  async update(id: string, data: Prisma.OrganizationUpdateInput): Promise<Organization> {
    return prisma.organization.update({
      where: { id },
      data,
    });
  }

  async getStats(id: string): Promise<{ users: number; properties: number; contracts: number; payments: number }> {
    const [users, properties, contracts, payments] = await Promise.all([
      prisma.user.count({ where: { organizationId: id, isActive: true } }),
      prisma.property.count({ where: { organizationId: id } }),
      prisma.contract.count({ where: { organizationId: id, status: 'active' } }),
      prisma.payment.count({ where: { organizationId: id, status: 'validated' } }),
    ]);

    return { users, properties, contracts, payments };
  }
}

export const organizationsRepository = new OrganizationsRepository();
