import { prisma } from '@/config/database';
import { NotFoundError, BadRequestError } from '@/shared/errors/AppError';
import { Landlord, Prisma } from '@prisma/client';
import { PaginationQuery, PaginationMeta } from '@/shared/types';
import { buildPaginationMeta } from '@/shared/helpers/pagination';

export class LandlordsService {
  async getAllLandlords(
    organizationId: string,
    query: PaginationQuery & { search?: string; status?: string }
  ): Promise<{ data: any[]; meta: PaginationMeta }> {
    const { page, limit, search, status } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.LandlordWhereInput = {
      organizationId,
      isActive: status === 'active' ? true : (status === 'inactive' ? false : undefined),
      OR: search
        ? [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { companyName: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ]
        : undefined,
    };

    const [landlords, total] = await Promise.all([
      prisma.landlord.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ lastName: 'asc' }, { companyName: 'asc' }],
        include: {
          properties: {
            select: {
              id: true,
              name: true,
              type: true,
              address: true,
              city: true,
              rentAmount: true,
              status: true,
              contracts: {
                where: { status: 'active' },
                select: { id: true, rentAmount: true },
              },
              children: {
                select: {
                  id: true,
                  name: true,
                  rentAmount: true,
                  status: true,
                  contracts: {
                    where: { status: 'active' },
                    select: { id: true, rentAmount: true },
                  },
                },
              },
            },
          },
          managementReports: {
            take: 1,
            orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
            select: { id: true, reportNumber: true, periodMonth: true, periodYear: true, status: true, netPayableToLandlord: true },
          },
        },
      }),
      prisma.landlord.count({ where }),
    ]);

    const formatted = landlords.map((l) => {
      let totalUnits = 0;
      let monthlyGrossRent = 0;
      let activeContractsCount = 0;

      (l.properties || []).forEach((prop: any) => {
        if (prop.children && prop.children.length > 0) {
          prop.children.forEach((child: any) => {
            totalUnits += 1;
            if (child.contracts && child.contracts.length > 0) {
              activeContractsCount += child.contracts.length;
              monthlyGrossRent += child.contracts.reduce((sum: number, c: any) => sum + Number(c.rentAmount || 0), 0);
            }
          });
        } else {
          totalUnits += 1;
          if (prop.contracts && prop.contracts.length > 0) {
            activeContractsCount += prop.contracts.length;
            monthlyGrossRent += prop.contracts.reduce((sum: number, c: any) => sum + Number(c.rentAmount || 0), 0);
          }
        }
      });

      const feeRate = Number(l.managementFeeRate || 8.0);
      const taxRate = Number(l.feeTaxRate || 0);
      const estimatedAgencyFee = monthlyGrossRent * (feeRate / 100);
      const estimatedFeeTax = estimatedAgencyFee * (taxRate / 100);
      const estimatedNetPayout = monthlyGrossRent - estimatedAgencyFee - estimatedFeeTax;

      const displayName = l.type === 'company' && l.companyName
        ? l.companyName
        : `${l.firstName || ''} ${l.lastName || ''}`.trim() || l.phone;

      return {
        id: l.id,
        type: l.type,
        firstName: l.firstName,
        lastName: l.lastName,
        companyName: l.companyName,
        displayName,
        email: l.email,
        phone: l.phone,
        address: l.address,
        city: l.city,
        idNumber: l.idNumber,
        bankName: l.bankName,
        ibanOrRib: l.ibanOrRib,
        mobileMoneyNumber: l.mobileMoneyNumber,
        managementFeeRate: feeRate,
        feeTaxRate: taxRate,
        notes: l.notes,
        isActive: l.isActive,
        createdAt: l.createdAt,
        propertiesCount: l.properties.length,
        totalUnitsCount: totalUnits,
        activeContractsCount,
        monthlyGrossRent,
        estimatedAgencyFee,
        estimatedNetPayout,
        lastReport: l.managementReports[0] || null,
        assignedProperties: l.properties.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          city: p.city,
        })),
      };
    });

    const meta = buildPaginationMeta(total, page, limit);
    return { data: formatted, meta };
  }

  async getLandlordById(id: string, organizationId: string): Promise<any> {
    const landlord = await prisma.landlord.findFirst({
      where: { id, organizationId },
      include: {
        properties: {
          include: {
            contracts: {
              where: { status: 'active' },
              include: { tenantProfile: true },
            },
            children: {
              include: {
                contracts: {
                  where: { status: 'active' },
                  include: { tenantProfile: true },
                },
                incidents: {
                  where: { status: { in: ['open', 'in_progress'] } },
                },
              },
            },
          },
        },
        managementReports: {
          orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
          take: 12,
        },
      },
    });

    if (!landlord) {
      throw new NotFoundError('Bailleur mandant introuvable.');
    }

    return landlord;
  }

  async createLandlord(organizationId: string, data: any): Promise<Landlord> {
    const { propertyIds, ...rest } = data;

    const landlord = await prisma.landlord.create({
      data: {
        ...rest,
        organizationId,
      },
    });

    if (Array.isArray(propertyIds) && propertyIds.length > 0) {
      await prisma.property.updateMany({
        where: { id: { in: propertyIds }, organizationId },
        data: { landlordId: landlord.id },
      });
    }

    return landlord;
  }

  async updateLandlord(id: string, organizationId: string, data: any): Promise<Landlord> {
    await this.getLandlordById(id, organizationId);
    const { propertyIds, ...rest } = data;

    const updated = await prisma.landlord.update({
      where: { id },
      data: rest,
    });

    if (Array.isArray(propertyIds)) {
      // Unlink properties no longer in the list
      await prisma.property.updateMany({
        where: { organizationId, landlordId: id, id: { notIn: propertyIds } },
        data: { landlordId: null },
      });

      // Link newly assigned properties
      if (propertyIds.length > 0) {
        await prisma.property.updateMany({
          where: { organizationId, id: { in: propertyIds } },
          data: { landlordId: id },
        });
      }
    }

    return updated;
  }

  async assignProperties(id: string, organizationId: string, propertyIds: string[]): Promise<any> {
    await this.getLandlordById(id, organizationId);

    // Unlink old
    await prisma.property.updateMany({
      where: { organizationId, landlordId: id },
      data: { landlordId: null },
    });

    // Link new
    if (propertyIds && propertyIds.length > 0) {
      await prisma.property.updateMany({
        where: { organizationId, id: { in: propertyIds } },
        data: { landlordId: id },
      });
    }

    return this.getLandlordById(id, organizationId);
  }

  async deleteLandlord(id: string, organizationId: string): Promise<void> {
    const landlord = await this.getLandlordById(id, organizationId);

    // Unlink properties
    await prisma.property.updateMany({
      where: { organizationId, landlordId: id },
      data: { landlordId: null },
    });

    await prisma.landlord.delete({
      where: { id },
    });
  }
}

export const landlordsService = new LandlordsService();
