import { prisma } from '@/config/database';
import { Payment, Prisma } from '@prisma/client';
import { PaginationQuery } from '@/shared/types';
import { generateReference } from '@/shared/helpers/crypto';

export class PaymentsRepository {
  async findAll(
    organizationId: string,
    options: PaginationQuery & {
      status?: string;
      contractId?: string;
      propertyId?: string;
      tenantProfileId?: string;
      paymentMethod?: string;
      startDate?: string;
      endDate?: string;
    }
  ): Promise<{ payments: any[]; total: number }> {
    const {
      page,
      limit,
      search,
      sortBy,
      sortOrder,
      status,
      contractId,
      propertyId,
      tenantProfileId,
      paymentMethod,
      startDate,
      endDate,
    } = options;
    const skip = (page - 1) * limit;

    const where: Prisma.PaymentWhereInput = {
      organizationId,
      status: status && status !== 'ALL' ? status : undefined,
      contractId: contractId && contractId !== 'ALL' ? contractId : undefined,
      tenantProfileId: tenantProfileId && tenantProfileId !== 'ALL' ? tenantProfileId : undefined,
      paymentMethod: paymentMethod && paymentMethod !== 'ALL' ? paymentMethod : undefined,
      contract: propertyId && propertyId !== 'ALL' ? { propertyId } : undefined,
      paymentDate:
        startDate || endDate
          ? {
              gte: startDate ? new Date(startDate) : undefined,
              lte: endDate ? new Date(new Date(endDate).setHours(23, 59, 59, 999)) : undefined,
            }
          : undefined,
      OR: search
        ? [
            { paymentReference: { contains: search, mode: 'insensitive' } },
            { transactionNumber: { contains: search, mode: 'insensitive' } },
            { tenantProfile: { firstName: { contains: search, mode: 'insensitive' } } },
            { tenantProfile: { lastName: { contains: search, mode: 'insensitive' } } },
            { contract: { contractNumber: { contains: search, mode: 'insensitive' } } },
            { contract: { property: { name: { contains: search, mode: 'insensitive' } } } },
          ]
        : undefined,
    };

    const orderByField = sortBy || 'paymentDate';
    const orderByDirection = (sortOrder || 'DESC').toLowerCase() as 'asc' | 'desc';

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [orderByField]: orderByDirection },
        include: {
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              periodMonth: true,
              periodYear: true,
              totalAmount: true,
              status: true,
            },
          },
          contract: {
            select: {
              id: true,
              contractNumber: true,
              paymentDay: true,
              property: {
                select: {
                  id: true,
                  name: true,
                  city: true,
                  type: true,
                  address: true,
                },
              },
            },
          },
          tenantProfile: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              email: true,
              reliabilityScore: true,
            },
          },
          declarer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              role: true,
            },
          },
          validator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              role: true,
            },
          },
          receipts: {
            select: {
              id: true,
              receiptNumber: true,
              pdfUrl: true,
              issuedAt: true,
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
      prisma.payment.count({ where }),
    ]);

    return { payments, total };
  }

  async findById(id: string, organizationId: string): Promise<any | null> {
    return prisma.payment.findFirst({
      where: { id, organizationId },
      include: {
        invoice: true,
        contract: {
          include: {
            property: true,
            tenantProfile: true,
          },
        },
        tenantProfile: true,
        declarer: { select: { id: true, firstName: true, lastName: true, role: true } },
        validator: { select: { id: true, firstName: true, lastName: true, role: true } },
        receipts: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  async findPending(organizationId: string): Promise<any[]> {
    return prisma.payment.findMany({
      where: {
        organizationId,
        status: { in: ['pending', 'complement_requested'] },
      },
      include: {
        tenantProfile: true,
        contract: { include: { property: true } },
        invoice: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    data: Omit<Prisma.PaymentUncheckedCreateInput, 'paymentReference'> & { paymentReference?: string }
  ): Promise<Payment> {
    const paymentReference = data.paymentReference || generateReference('PAY');

    return prisma.payment.create({
      data: {
        ...data,
        paymentReference,
      },
    });
  }

  async update(id: string, data: Prisma.PaymentUpdateInput): Promise<Payment> {
    return prisma.payment.update({
      where: { id },
      data,
    });
  }

  async getStats(organizationId: string): Promise<any> {
    const [totalCount, pendingCount, validatedCount, rejectedCount, complementCount] = await Promise.all([
      prisma.payment.count({ where: { organizationId } }),
      prisma.payment.count({ where: { organizationId, status: 'pending' } }),
      prisma.payment.count({ where: { organizationId, status: 'validated' } }),
      prisma.payment.count({ where: { organizationId, status: 'rejected' } }),
      prisma.payment.count({ where: { organizationId, status: 'complement_requested' } }),
    ]);

    const [validatedSums, pendingSums] = await Promise.all([
      prisma.payment.aggregate({
        where: { organizationId, status: 'validated' },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { organizationId, status: { in: ['pending', 'complement_requested'] } },
        _sum: { amount: true },
      }),
    ]);

    const validatedAmount = Number(validatedSums._sum.amount || 0);
    const pendingAmount = Number(pendingSums._sum.amount || 0);
    const approvalRate =
      totalCount > 0 ? Math.round((validatedCount / (validatedCount + rejectedCount || 1)) * 100) : 100;

    return {
      total: totalCount,
      pending: pendingCount,
      validated: validatedCount,
      rejected: rejectedCount,
      complementRequested: complementCount,
      validatedAmount,
      pendingAmount,
      approvalRate,
    };
  }
}

export const paymentsRepository = new PaymentsRepository();
