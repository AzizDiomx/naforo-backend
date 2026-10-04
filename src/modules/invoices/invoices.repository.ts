import { prisma } from '@/config/database';
import { Invoice, Prisma } from '@prisma/client';
import { PaginationQuery } from '@/shared/types';
import { generateReference } from '@/shared/helpers/crypto';

export class InvoicesRepository {
  async findAll(
    organizationId: string,
    options: PaginationQuery & {
      status?: string;
      contractId?: string;
      propertyId?: string;
      tenantProfileId?: string;
      month?: number;
      year?: number;
    }
  ): Promise<{ invoices: Invoice[]; total: number }> {
    const { page, limit, search, sortBy, sortOrder, status, contractId, propertyId, tenantProfileId, month, year } = options;
    const skip = (page - 1) * limit;

    const where: Prisma.InvoiceWhereInput = {
      organizationId,
      status: status && status !== 'ALL' ? status : undefined,
      contractId: contractId || undefined,
      propertyId: propertyId || undefined,
      tenantProfileId: tenantProfileId || undefined,
      periodMonth: month || undefined,
      periodYear: year || undefined,
      OR: search
        ? [
            { invoiceNumber: { contains: search, mode: 'insensitive' } },
            { tenantProfile: { firstName: { contains: search, mode: 'insensitive' } } },
            { tenantProfile: { lastName: { contains: search, mode: 'insensitive' } } },
            { property: { name: { contains: search, mode: 'insensitive' } } },
          ]
        : undefined,
    };

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy || 'dueDate']: (sortOrder || 'DESC').toLowerCase() as 'asc' | 'desc' },
        include: {
          contract: { select: { contractNumber: true, paymentDay: true } },
          property: { select: { id: true, name: true, type: true, city: true, address: true } },
          tenantProfile: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
          payments: {
            where: { status: 'validated' },
            select: { id: true, amount: true, paymentMethod: true, paymentDate: true, paymentReference: true },
          },
        },
      }),
      prisma.invoice.count({ where }),
    ]);

    return { invoices, total };
  }

  async findById(id: string, organizationId: string): Promise<any> {
    return prisma.invoice.findFirst({
      where: { id, organizationId },
      include: {
        contract: { include: { property: true, tenantProfile: true } },
        tenantProfile: true,
        property: true,
        payments: {
          orderBy: { createdAt: 'desc' },
          include: { declarer: { select: { firstName: true, lastName: true } }, validator: { select: { firstName: true, lastName: true } } },
        },
      },
    });
  }

  async findByContract(contractId: string): Promise<any[]> {
    return prisma.invoice.findMany({
      where: { contractId },
      orderBy: { dueDate: 'desc' },
      include: {
        payments: { where: { status: 'validated' } },
      },
    });
  }

  async findOverdue(organizationId: string): Promise<any[]> {
    return prisma.invoice.findMany({
      where: {
        organizationId,
        status: { in: ['pending', 'partial', 'overdue'] },
        dueDate: { lt: new Date() },
      },
      include: {
        tenantProfile: true,
        property: true,
      },
    });
  }

  async existsForPeriod(contractId: string, periodMonth: number, periodYear: number): Promise<boolean> {
    const count = await prisma.invoice.count({
      where: {
        contractId,
        periodMonth,
        periodYear,
        status: { not: 'cancelled' },
      },
    });
    return count > 0;
  }

  async create(data: Prisma.InvoiceUncheckedCreateInput): Promise<Invoice> {
    const invoiceNumber = data.invoiceNumber || generateReference('INV');
    
    return prisma.invoice.create({
      data: {
        ...data,
        invoiceNumber,
      },
    });
  }

  async update(id: string, data: Prisma.InvoiceUpdateInput): Promise<Invoice> {
    return prisma.invoice.update({
      where: { id },
      data,
    });
  }

  async getStats(organizationId: string): Promise<any> {
    const [pendingCount, paidCount, overdueCount, partialCount, totalCount] = await Promise.all([
      prisma.invoice.count({ where: { organizationId, status: 'pending' } }),
      prisma.invoice.count({ where: { organizationId, status: 'paid' } }),
      prisma.invoice.count({ where: { organizationId, status: 'overdue' } }),
      prisma.invoice.count({ where: { organizationId, status: 'partial' } }),
      prisma.invoice.count({ where: { organizationId, status: { not: 'cancelled' } } }),
    ]);

    const totalDueAgg = await prisma.invoice.aggregate({
      where: { organizationId, status: { in: ['pending', 'overdue', 'partial'] } },
      _sum: { totalAmount: true },
    });

    const totalCollectedAgg = await prisma.invoice.aggregate({
      where: { organizationId, status: 'paid' },
      _sum: { totalAmount: true },
    });

    const totalDue = Number(totalDueAgg._sum.totalAmount || 0);
    const totalCollected = Number(totalCollectedAgg._sum.totalAmount || 0);
    const totalBilled = totalDue + totalCollected;
    const recoveryRate = totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 100) : 100;

    return {
      pending: pendingCount,
      paid: paidCount,
      overdue: overdueCount,
      partial: partialCount,
      total: totalCount,
      totalDue,
      totalCollected,
      totalBilled,
      recoveryRate,
    };
  }
}

export const invoicesRepository = new InvoicesRepository();
