import { prisma } from '@/config/database';
import { Organization, Prisma } from '@prisma/client';
import { PaginationQuery } from '@/shared/types';
import { LOT_PROPERTY_TYPES } from '@/shared/helpers/plan-policy';

export class OrganizationsRepository {
  async findAll(options: PaginationQuery): Promise<{ organizations: any[]; total: number }> {
    const { page, limit, search, sortBy, sortOrder } = options;
    const skip = (page - 1) * limit;

    const where: Prisma.OrganizationWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search, mode: 'insensitive' } },
            { city: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [organizations, total] = await Promise.all([
      prisma.organization.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy || 'createdAt']: (sortOrder || 'DESC').toLowerCase() as 'asc' | 'desc' },
        include: {
          _count: {
            select: {
              users: true,
              properties: true,
              contracts: true,
              tenantProfiles: true,
              payments: true,
              invoices: true,
            },
          },
          subscriptions: {
            where: { status: 'active' },
            include: { plan: true },
            take: 1,
            orderBy: { endDate: 'desc' },
          },
        },
      }),
      prisma.organization.count({ where }),
    ]);

    return { organizations, total };
  }

  async findById(id: string): Promise<any | null> {
    return prisma.organization.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            users: true,
            properties: true,
            contracts: true,
            tenantProfiles: true,
            invoices: true,
            payments: true,
            incidents: true,
            documents: true,
          },
        },
        subscriptions: {
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
        users: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            role: true,
            isActive: true,
            createdAt: true,
            lastLoginAt: true,
          },
          take: 25,
          orderBy: { createdAt: 'desc' },
        },
      },
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

  async getStats(id: string): Promise<any> {
    const unitTypesFilter = { notIn: [...LOT_PROPERTY_TYPES] };
    const lotTypesFilter = { in: [...LOT_PROPERTY_TYPES] };

    const [
      users,
      lotsTotal,
      propertiesTotal,
      propertiesAvailable,
      propertiesOccupied,
      propertiesMaintenance,
      contractsTotal,
      contractsActive,
      tenantsTotal,
      paymentsValidated,
      paymentsTotalSum,
      invoicesPending,
      invoicesOverdue,
      invoicesPaid,
      activeSub,
    ] = await Promise.all([
      prisma.user.count({ where: { organizationId: id, isActive: true } }),
      prisma.property.count({ where: { organizationId: id, type: lotTypesFilter } }),
      prisma.property.count({ where: { organizationId: id, type: unitTypesFilter } }),
      prisma.property.count({ where: { organizationId: id, type: unitTypesFilter, status: 'available' } }),
      prisma.property.count({ where: { organizationId: id, type: unitTypesFilter, status: 'occupied' } }),
      prisma.property.count({ where: { organizationId: id, type: unitTypesFilter, status: 'maintenance' } }),
      prisma.contract.count({ where: { organizationId: id } }),
      prisma.contract.count({ where: { organizationId: id, status: 'active' } }),
      prisma.tenantProfile.count({ where: { organizationId: id } }),
      prisma.payment.count({ where: { organizationId: id, status: 'validated' } }),
      prisma.payment.aggregate({
        where: { organizationId: id, status: 'validated' },
        _sum: { amount: true },
      }),
      prisma.invoice.aggregate({
        where: { organizationId: id, status: 'pending' },
        _count: { id: true },
        _sum: { totalAmount: true },
      }),
      prisma.invoice.aggregate({
        where: { organizationId: id, status: 'overdue' },
        _count: { id: true },
        _sum: { totalAmount: true },
      }),
      prisma.invoice.aggregate({
        where: { organizationId: id, status: 'paid' },
        _count: { id: true },
        _sum: { totalAmount: true },
      }),
      prisma.subscription.findFirst({
        where: { organizationId: id },
        include: { plan: true },
        orderBy: { endDate: 'desc' },
      }),
    ]);

    const occupancyRate = propertiesTotal > 0 ? Math.round((propertiesOccupied / propertiesTotal) * 100) : 0;

    return {
      users,
      lots: lotsTotal,
      properties: {
        total: propertiesTotal,
        lots: lotsTotal,
        available: propertiesAvailable,
        occupied: propertiesOccupied,
        maintenance: propertiesMaintenance,
        occupancyRate,
      },
      tenants: tenantsTotal,
      contracts: {
        total: contractsTotal,
        active: contractsActive,
      },
      payments: {
        validatedCount: paymentsValidated,
        totalCollectedAmount: Number(paymentsTotalSum._sum.amount || 0),
      },
      invoices: {
        pendingCount: invoicesPending._count.id,
        pendingAmount: Number(invoicesPending._sum.totalAmount || 0),
        overdueCount: invoicesOverdue._count.id,
        overdueAmount: Number(invoicesOverdue._sum.totalAmount || 0),
        paidCount: invoicesPaid._count.id,
        paidAmount: Number(invoicesPaid._sum.totalAmount || 0),
      },
      subscription: activeSub
        ? {
            id: activeSub.id,
            planName: activeSub.plan?.name || 'Inconnu',
            planCode: activeSub.plan?.code || 'starter',
            status: activeSub.status,
            startDate: activeSub.startDate,
            endDate: activeSub.endDate,
          }
        : null,
    };
  }
}

export const organizationsRepository = new OrganizationsRepository();
