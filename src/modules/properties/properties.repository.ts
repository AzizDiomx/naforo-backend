import { prisma } from '@/config/database';
import { Property, Prisma } from '@prisma/client';
import { PaginationQuery } from '@/shared/types';

export class PropertiesRepository {
  async findAll(
    organizationId: string,
    options: PaginationQuery & { type?: string; status?: string }
  ): Promise<{ properties: Property[]; total: number }> {
    const { page, limit, search, sortBy, sortOrder, type, status } = options;
    const skip = (page - 1) * limit;

    const where: Prisma.PropertyWhereInput = {
      organizationId,
      type: type || undefined,
      status: status || undefined,
      OR: search
        ? [
            { name: { contains: search, mode: 'insensitive' } },
            { address: { contains: search, mode: 'insensitive' } },
            { city: { contains: search, mode: 'insensitive' } },
          ]
        : undefined,
    };

    const [properties, total] = await Promise.all([
      prisma.property.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy || 'createdAt']: (sortOrder || 'ASC').toLowerCase() as 'asc' | 'desc' },
        include: {
          parent: { select: { name: true } },
        },
      }),
      prisma.property.count({ where }),
    ]);

    return { properties, total };
  }

  async findById(id: string, organizationId: string): Promise<Property | null> {
    return prisma.property.findFirst({
      where: { id, organizationId },
      include: {
        children: true,
        parent: true,
        contracts: {
          where: { status: 'active' },
          include: { tenantProfile: true },
        },
      },
    });
  }

  async findAvailable(organizationId: string): Promise<Property[]> {
    return prisma.property.findMany({
      where: {
        organizationId,
        status: 'available',
      },
      orderBy: { name: 'asc' },
    });
  }

  async create(data: Prisma.PropertyUncheckedCreateInput): Promise<Property> {
    return prisma.property.create({
      data,
    });
  }

  async update(id: string, data: Prisma.PropertyUpdateInput): Promise<Property> {
    return prisma.property.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<Property> {
    return prisma.property.delete({
      where: { id },
    });
  }

  async getStats(organizationId: string): Promise<any> {
    const [total, available, occupied, maintenance] = await Promise.all([
      prisma.property.count({ where: { organizationId } }),
      prisma.property.count({ where: { organizationId, status: 'available' } }),
      prisma.property.count({ where: { organizationId, status: 'occupied' } }),
      prisma.property.count({ where: { organizationId, status: 'maintenance' } }),
    ]);

    const countsByType = await prisma.property.groupBy({
      by: ['type'],
      where: { organizationId },
      _count: { id: true },
    });

    return {
      total,
      available,
      occupied,
      maintenance,
      byType: countsByType.reduce((acc: any, curr) => {
        acc[curr.type] = curr._count.id;
        return acc;
      }, {}),
    };
  }
}

export const propertiesRepository = new PropertiesRepository();
