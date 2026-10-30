import { prisma } from '@/config/database';
import { Property, Prisma } from '@prisma/client';
import { PaginationQuery } from '@/shared/types';
import { LOT_PROPERTY_TYPES } from '@/shared/helpers/plan-policy';

export class PropertiesRepository {
  async findAll(
    organizationId: string,
    options: PaginationQuery & { type?: string; status?: string; managerId?: string },
    user?: { role: string; userId: string }
  ): Promise<{ properties: Property[]; total: number }> {
    const { page, limit, search, sortBy, sortOrder, type, status, managerId } = options;
    const skip = (page - 1) * limit;

    const andConditions: Prisma.PropertyWhereInput[] = [
      { organizationId },
    ];

    if (type) andConditions.push({ type });
    if (status) andConditions.push({ status });

    // Scoping for manager role or explicit filter by admin
    if (user && user.role === 'manager') {
      andConditions.push({
        OR: [
          { managerId: user.userId },
          { parent: { managerId: user.userId } },
        ],
      });
    } else if (managerId) {
      andConditions.push({
        OR: [
          { managerId },
          { parent: { managerId } },
        ],
      });
    }

    if (search) {
      andConditions.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { address: { contains: search, mode: 'insensitive' } },
          { city: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    const where: Prisma.PropertyWhereInput = {
      AND: andConditions,
    };

    const [properties, total] = await Promise.all([
      prisma.property.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy || 'createdAt']: (sortOrder || 'ASC').toLowerCase() as 'asc' | 'desc' },
        include: {
          parent: { select: { id: true, name: true, type: true } },
          manager: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
          landlord: { select: { id: true, firstName: true, lastName: true, companyName: true, type: true } },
        },
      }),
      prisma.property.count({ where }),
    ]);

    return { properties, total };
  }

  async findById(id: string, organizationId: string): Promise<any | null> {
    return prisma.property.findFirst({
      where: { id, organizationId },
      include: {
        manager: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            role: true,
          },
        },
        landlord: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            companyName: true,
            type: true,
            email: true,
            phone: true,
            managementFeeRate: true,
          },
        },
        parent: {
          select: {
            id: true,
            name: true,
            type: true,
            address: true,
            city: true,
            manager: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
              },
            },
          },
        },
        children: {
          include: {
            manager: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            contracts: {
              where: { status: 'active' },
              include: { tenantProfile: true },
            },
            incidents: {
              where: { status: { in: ['open', 'in_progress'] } },
            },
          },
          orderBy: [{ floor: 'asc' }, { name: 'asc' }],
        },
        contracts: {
          orderBy: { startDate: 'desc' },
          include: {
            tenantProfile: true,
            invoices: {
              select: { id: true, invoiceNumber: true, totalAmount: true, status: true, periodMonth: true, periodYear: true, dueDate: true },
              take: 12,
              orderBy: { createdAt: 'desc' },
            },
            receipts: {
              select: { id: true, receiptNumber: true, amount: true, issuedAt: true, pdfUrl: true },
              take: 12,
              orderBy: { issuedAt: 'desc' },
            },
          },
        },
        incidents: {
          orderBy: { createdAt: 'desc' },
          include: {
            tenantProfile: {
              select: { id: true, firstName: true, lastName: true, phone: true, avatarUrl: true },
            },
            assignee: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
      },
    });
  }

  async findLots(organizationId: string, user?: { role: string; userId: string }): Promise<any[]> {
    const andConditions: Prisma.PropertyWhereInput[] = [
      { organizationId },
      {
        // Un LOT = type regroupement (immeuble, résidence, lot) OU tout bien contenant des sous-unités
        OR: [
          { type: { in: [...LOT_PROPERTY_TYPES] } },
          { children: { some: {} } },
        ],
      },
    ];

    if (user && user.role === 'manager') {
      andConditions.push({
        OR: [
          { managerId: user.userId },
          { children: { some: { managerId: user.userId } } },
        ],
      });
    }

    return prisma.property.findMany({
      where: { AND: andConditions },
      include: {
        manager: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        _count: {
          select: { children: true },
        },
        children: {
          select: {
            id: true,
            name: true,
            type: true,
            floor: true,
            areaSqm: true,
            status: true,
            rentAmount: true,
            chargesAmount: true,
            managerId: true,
            manager: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
            contracts: {
              where: { status: 'active' },
              select: {
                id: true,
                contractNumber: true,
                tenantProfile: {
                  select: { id: true, firstName: true, lastName: true, phone: true },
                },
              },
            },
            incidents: {
              where: { status: { in: ['open', 'in_progress'] } },
              select: { id: true, title: true, priority: true, status: true },
            },
          },
          orderBy: [{ floor: 'asc' }, { name: 'asc' }],
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getAdvancedLotStatistics(organizationId: string, lotId?: string): Promise<any> {
    const today = new Date();
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();

    const lotWhere: Prisma.PropertyWhereInput = {
      organizationId,
      ...(lotId ? { id: lotId } : {
        OR: [
          { type: { in: [...LOT_PROPERTY_TYPES] } },
          { children: { some: {} } },
        ],
      }),
    };

    const lots = await prisma.property.findMany({
      where: lotWhere,
      include: {
        children: {
          include: {
            contracts: {
              where: { status: 'active' },
              include: {
                tenantProfile: {
                  select: { id: true, firstName: true, lastName: true, phone: true, email: true, reliabilityScore: true },
                },
                invoices: {
                  where: { periodMonth: currentMonth, periodYear: currentYear },
                  select: { id: true, status: true, totalAmount: true },
                },
              },
            },
            incidents: {
              orderBy: { createdAt: 'desc' },
              select: {
                id: true,
                title: true,
                type: true,
                status: true,
                priority: true,
                createdAt: true,
              },
            },
          },
          orderBy: [{ floor: 'asc' }, { name: 'asc' }],
        },
      },
      orderBy: { name: 'asc' },
    });

    const standaloneProperties = !lotId ? await prisma.property.findMany({
      where: {
        organizationId,
        parentId: null,
        children: { none: {} },
        type: { notIn: [...LOT_PROPERTY_TYPES] },
      },
      include: {
        contracts: {
          where: { status: 'active' },
          include: {
            tenantProfile: {
              select: { id: true, firstName: true, lastName: true, phone: true, email: true, reliabilityScore: true },
            },
            invoices: {
              where: { periodMonth: currentMonth, periodYear: currentYear },
              select: { id: true, status: true, totalAmount: true },
            },
          },
        },
        incidents: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            title: true,
            type: true,
            status: true,
            priority: true,
            createdAt: true,
          },
        },
      },
    }) : [];

    const lotsMetrics = lots.map((lot) => {
      const units = lot.children.map((unit) => {
        const activeContract = unit.contracts[0] || null;
        const currentInvoice = activeContract?.invoices[0] || null;
        const isCurrentMonthPaid = currentInvoice ? currentInvoice.status === 'paid' : (unit.status !== 'occupied');
        const openIncidents = unit.incidents.filter((i) => i.status === 'open' || i.status === 'in_progress');

        return {
          id: unit.id,
          name: unit.name,
          type: unit.type,
          floor: unit.floor,
          areaSqm: unit.areaSqm ? Number(unit.areaSqm) : null,
          rooms: unit.rooms,
          status: unit.status,
          rentAmount: unit.rentAmount ? Number(unit.rentAmount) : 0,
          chargesAmount: unit.chargesAmount ? Number(unit.chargesAmount) : 0,
          totalMonthly: Number(unit.rentAmount || 0) + Number(unit.chargesAmount || 0),
          currentTenant: activeContract ? activeContract.tenantProfile : null,
          contractId: activeContract?.id || null,
          contractStatus: activeContract?.status || null,
          currentInvoiceStatus: currentInvoice?.status || (activeContract ? 'pending' : 'none'),
          isCurrentMonthPaid,
          openIncidentsCount: openIncidents.length,
          totalIncidentsCount: unit.incidents.length,
          recentIncidents: unit.incidents.slice(0, 3),
        };
      });

      const totalUnits = units.length;
      const occupiedUnits = units.filter((u) => u.status === 'occupied').length;
      const availableUnits = units.filter((u) => u.status === 'available').length;
      const maintenanceUnits = units.filter((u) => u.status === 'maintenance').length;
      const occupancyRate = totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 1000) / 10 : 0;

      const totalTheoreticalRent = units.reduce((sum, u) => sum + u.totalMonthly, 0);
      const totalOccupiedRent = units.filter((u) => u.status === 'occupied').reduce((sum, u) => sum + u.totalMonthly, 0);
      const paidUnits = units.filter((u) => u.status === 'occupied' && u.isCurrentMonthPaid);
      const totalCollectedThisMonth = paidUnits.reduce((sum, u) => sum + u.totalMonthly, 0);
      const totalOverdueThisMonth = totalOccupiedRent - totalCollectedThisMonth;
      const collectionRate = totalOccupiedRent > 0 ? Math.round((totalCollectedThisMonth / totalOccupiedRent) * 1000) / 10 : 100;

      const totalActiveIncidents = units.reduce((sum, u) => sum + u.openIncidentsCount, 0);
      const totalIncidents = units.reduce((sum, u) => sum + u.totalIncidentsCount, 0);

      return {
        id: lot.id,
        name: lot.name,
        type: lot.type,
        address: lot.address,
        city: lot.city,
        totalUnits,
        occupiedUnits,
        availableUnits,
        maintenanceUnits,
        occupancyRate,
        totalTheoreticalRent,
        totalOccupiedRent,
        totalCollectedThisMonth,
        totalOverdueThisMonth,
        collectionRate,
        totalActiveIncidents,
        totalIncidents,
        units,
      };
    });

    if (standaloneProperties.length > 0) {
      const standaloneUnits = standaloneProperties.map((unit) => {
        const activeContract = unit.contracts[0] || null;
        const currentInvoice = activeContract?.invoices[0] || null;
        const isCurrentMonthPaid = currentInvoice ? currentInvoice.status === 'paid' : (unit.status !== 'occupied');
        const openIncidents = unit.incidents.filter((i) => i.status === 'open' || i.status === 'in_progress');

        return {
          id: unit.id,
          name: unit.name,
          type: unit.type,
          floor: unit.floor,
          areaSqm: unit.areaSqm ? Number(unit.areaSqm) : null,
          rooms: unit.rooms,
          status: unit.status,
          rentAmount: unit.rentAmount ? Number(unit.rentAmount) : 0,
          chargesAmount: unit.chargesAmount ? Number(unit.chargesAmount) : 0,
          totalMonthly: Number(unit.rentAmount || 0) + Number(unit.chargesAmount || 0),
          currentTenant: activeContract ? activeContract.tenantProfile : null,
          contractId: activeContract?.id || null,
          contractStatus: activeContract?.status || null,
          currentInvoiceStatus: currentInvoice?.status || (activeContract ? 'pending' : 'none'),
          isCurrentMonthPaid,
          openIncidentsCount: openIncidents.length,
          totalIncidentsCount: unit.incidents.length,
          recentIncidents: unit.incidents.slice(0, 3),
        };
      });

      const totalUnits = standaloneUnits.length;
      const occupiedUnits = standaloneUnits.filter((u) => u.status === 'occupied').length;
      const availableUnits = standaloneUnits.filter((u) => u.status === 'available').length;
      const maintenanceUnits = standaloneUnits.filter((u) => u.status === 'maintenance').length;
      const occupancyRate = totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 1000) / 10 : 0;
      const totalTheoreticalRent = standaloneUnits.reduce((sum, u) => sum + u.totalMonthly, 0);
      const totalOccupiedRent = standaloneUnits.filter((u) => u.status === 'occupied').reduce((sum, u) => sum + u.totalMonthly, 0);
      const paidUnits = standaloneUnits.filter((u) => u.status === 'occupied' && u.isCurrentMonthPaid);
      const totalCollectedThisMonth = paidUnits.reduce((sum, u) => sum + u.totalMonthly, 0);
      const totalOverdueThisMonth = totalOccupiedRent - totalCollectedThisMonth;
      const collectionRate = totalOccupiedRent > 0 ? Math.round((totalCollectedThisMonth / totalOccupiedRent) * 1000) / 10 : 100;

      lotsMetrics.push({
        id: 'standalone',
        name: 'Biens Individuels (Hors Lots)',
        type: 'individual',
        address: 'Diverses adresses',
        city: 'Toutes villes',
        totalUnits,
        occupiedUnits,
        availableUnits,
        maintenanceUnits,
        occupancyRate,
        totalTheoreticalRent,
        totalOccupiedRent,
        totalCollectedThisMonth,
        totalOverdueThisMonth,
        collectionRate,
        totalActiveIncidents: standaloneUnits.reduce((sum, u) => sum + u.openIncidentsCount, 0),
        totalIncidents: standaloneUnits.reduce((sum, u) => sum + u.totalIncidentsCount, 0),
        units: standaloneUnits,
      });
    }

    const globalTotalUnits = lotsMetrics.reduce((sum, l) => sum + l.totalUnits, 0);
    const globalOccupiedUnits = lotsMetrics.reduce((sum, l) => sum + l.occupiedUnits, 0);
    const globalAvailableUnits = lotsMetrics.reduce((sum, l) => sum + l.availableUnits, 0);
    const globalMaintenanceUnits = lotsMetrics.reduce((sum, l) => sum + l.maintenanceUnits, 0);
    const globalOccupancyRate = globalTotalUnits > 0 ? Math.round((globalOccupiedUnits / globalTotalUnits) * 1000) / 10 : 0;
    const globalTheoreticalRent = lotsMetrics.reduce((sum, l) => sum + l.totalTheoreticalRent, 0);
    const globalOccupiedRent = lotsMetrics.reduce((sum, l) => sum + l.totalOccupiedRent, 0);
    const globalCollectedThisMonth = lotsMetrics.reduce((sum, l) => sum + l.totalCollectedThisMonth, 0);
    const globalOverdueThisMonth = lotsMetrics.reduce((sum, l) => sum + l.totalOverdueThisMonth, 0);
    const globalCollectionRate = globalOccupiedRent > 0 ? Math.round((globalCollectedThisMonth / globalOccupiedRent) * 1000) / 10 : 100;
    const globalActiveIncidents = lotsMetrics.reduce((sum, l) => sum + l.totalActiveIncidents, 0);

    return {
      period: { month: currentMonth, year: currentYear },
      global: {
        totalLots: lots.length,
        totalUnits: globalTotalUnits,
        occupiedUnits: globalOccupiedUnits,
        availableUnits: globalAvailableUnits,
        maintenanceUnits: globalMaintenanceUnits,
        occupancyRate: globalOccupancyRate,
        theoreticalMonthlyRent: globalTheoreticalRent,
        occupiedMonthlyRent: globalOccupiedRent,
        collectedThisMonth: globalCollectedThisMonth,
        overdueThisMonth: globalOverdueThisMonth,
        collectionRate: globalCollectionRate,
        activeIncidentsCount: globalActiveIncidents,
      },
      lots: lotsMetrics,
    };
  }

  async findAvailable(organizationId: string): Promise<Property[]> {
    // Seuls les BIENS (unités louables) peuvent faire l'objet d'un bail ; les lots sont exclus
    return prisma.property.findMany({
      where: {
        organizationId,
        status: 'available',
        type: { notIn: [...LOT_PROPERTY_TYPES] },
        children: { none: {} },
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
    // Les LOTS (regroupements) sont comptés à part : seuls les BIENS (unités locatives) entrent dans les KPI d'occupation
    const unitWhere: Prisma.PropertyWhereInput = {
      organizationId,
      type: { notIn: [...LOT_PROPERTY_TYPES] },
    };

    const [total, available, occupied, maintenance, lotsCount] = await Promise.all([
      prisma.property.count({ where: unitWhere }),
      prisma.property.count({ where: { ...unitWhere, status: 'available' } }),
      prisma.property.count({ where: { ...unitWhere, status: 'occupied' } }),
      prisma.property.count({ where: { ...unitWhere, status: 'maintenance' } }),
      prisma.property.count({ where: { organizationId, type: { in: [...LOT_PROPERTY_TYPES] } } }),
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
      lotsCount,
      byType: countsByType.reduce((acc: any, curr) => {
        acc[curr.type] = curr._count.id;
        return acc;
      }, {}),
    };
  }
}

export const propertiesRepository = new PropertiesRepository();
