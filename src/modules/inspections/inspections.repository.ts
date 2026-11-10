import { prisma } from '@/config/database';
import { PropertyInspection, Prisma } from '@prisma/client';
import { PaginationQuery } from '@/shared/types';

export class InspectionsRepository {
  async create(data: Prisma.PropertyInspectionUncheckedCreateInput): Promise<PropertyInspection> {
    return prisma.propertyInspection.create({
      data,
      include: {
        property: true,
        contract: true,
        tenantProfile: true,
        inspector: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  async update(id: string, data: Prisma.PropertyInspectionUncheckedUpdateInput): Promise<PropertyInspection> {
    return prisma.propertyInspection.update({
      where: { id },
      data,
      include: {
        property: true,
        contract: true,
        tenantProfile: true,
        inspector: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  async findById(id: string, organizationId: string): Promise<any> {
    return prisma.propertyInspection.findFirst({
      where: { id, organizationId },
      include: {
        property: { include: { landlord: true } },
        contract: true,
        tenantProfile: true,
        inspector: { select: { id: true, firstName: true, lastName: true, email: true } },
        organization: true,
      },
    });
  }

  async findByContractAndType(contractId: string, type: string, organizationId: string): Promise<any> {
    return prisma.propertyInspection.findFirst({
      where: { contractId, type, organizationId },
      include: {
        property: true,
        contract: true,
        tenantProfile: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAll(
    organizationId: string,
    query: PaginationQuery & {
      type?: string;
      status?: string;
      propertyId?: string;
      contractId?: string;
      tenantProfileId?: string;
    }
  ): Promise<{ inspections: PropertyInspection[]; total: number }> {
    const { page = 1, limit = 20, type, status, propertyId, contractId, tenantProfileId, search } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.PropertyInspectionWhereInput = {
      organizationId,
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
      ...(propertyId ? { propertyId } : {}),
      ...(contractId ? { contractId } : {}),
      ...(tenantProfileId ? { tenantProfileId } : {}),
      ...(search
        ? {
            OR: [
              { inspectionNumber: { contains: search, mode: 'insensitive' } },
              { inspectorName: { contains: search, mode: 'insensitive' } },
              { property: { name: { contains: search, mode: 'insensitive' } } },
              { tenantProfile: { firstName: { contains: search, mode: 'insensitive' } } },
              { tenantProfile: { lastName: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [inspections, total] = await Promise.all([
      prisma.propertyInspection.findMany({
        where,
        skip,
        take: limit,
        orderBy: { inspectionDate: 'desc' },
        include: {
          property: { select: { id: true, name: true, address: true, type: true } },
          contract: { select: { id: true, contractNumber: true, startDate: true, endDate: true } },
          tenantProfile: { select: { id: true, firstName: true, lastName: true, phone: true } },
          inspector: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.propertyInspection.count({ where }),
    ]);

    return { inspections, total };
  }

  async delete(id: string, organizationId: string): Promise<PropertyInspection> {
    return prisma.propertyInspection.delete({
      where: { id },
    });
  }
}

export const inspectionsRepository = new InspectionsRepository();
