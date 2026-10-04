import { prisma } from '@/config/database';
import { Incident, Prisma } from '@prisma/client';
import { PaginationQuery } from '@/shared/types';
import { generateReference } from '@/shared/helpers/crypto';

export class IncidentsRepository {
  async findAll(
    organizationId: string,
    options: PaginationQuery & { status?: string; type?: string; priority?: string; propertyId?: string }
  ): Promise<{ incidents: Incident[]; total: number }> {
    const { page, limit, search, sortBy, sortOrder, status, type, priority, propertyId } = options;
    const skip = (page - 1) * limit;

    const where: Prisma.IncidentWhereInput = {
      organizationId,
      status: status || undefined,
      type: type || undefined,
      priority: priority || undefined,
      propertyId: propertyId || undefined,
      OR: search
        ? [
            { incidentNumber: { contains: search, mode: 'insensitive' } },
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { property: { name: { contains: search, mode: 'insensitive' } } },
          ]
        : undefined,
    };

    const [incidents, total] = await Promise.all([
      prisma.incident.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy || 'createdAt']: (sortOrder || 'ASC').toLowerCase() as 'asc' | 'desc' },
        include: {
          property: { select: { id: true, name: true, address: true, city: true, type: true } },
          tenantProfile: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
          assignee: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, role: true } },
        },
      }),
      prisma.incident.count({ where }),
    ]);

    return { incidents, total };
  }

  async findById(id: string, organizationId: string): Promise<Incident | null> {
    return prisma.incident.findFirst({
      where: { id, organizationId },
      include: {
        property: true,
        tenantProfile: true,
        assignee: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, role: true } },
      },
    });
  }

  async create(data: Omit<Prisma.IncidentUncheckedCreateInput, 'incidentNumber'>): Promise<Incident> {
    const incidentNumber = generateReference('INC');
    
    return prisma.incident.create({
      data: {
        ...data,
        incidentNumber,
      },
    });
  }

  async update(id: string, data: Prisma.IncidentUncheckedUpdateInput): Promise<Incident> {
    return prisma.incident.update({
      where: { id },
      data,
    });
  }

  async getStats(organizationId: string): Promise<any> {
    const [openCount, inProgressCount, resolvedCount, closedCount] = await Promise.all([
      prisma.incident.count({ where: { organizationId, status: 'open' } }),
      prisma.incident.count({ where: { organizationId, status: 'in_progress' } }),
      prisma.incident.count({ where: { organizationId, status: 'resolved' } }),
      prisma.incident.count({ where: { organizationId, status: 'closed' } }),
    ]);

    const countsByType = await prisma.incident.groupBy({
      by: ['type'],
      where: { organizationId },
      _count: { id: true },
    });

    return {
      open: openCount,
      inProgress: inProgressCount,
      resolved: resolvedCount,
      closed: closedCount,
      byType: countsByType.reduce((acc: any, curr) => {
        acc[curr.type] = curr._count.id;
        return acc;
      }, {}),
    };
  }
}

export const incidentsRepository = new IncidentsRepository();
