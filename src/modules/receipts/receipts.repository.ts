import { prisma } from '@/config/database';
import { Receipt, Prisma } from '@prisma/client';
import { PaginationQuery } from '@/shared/types';

export class ReceiptsRepository {
  async findAll(
    organizationId: string,
    options: PaginationQuery & { contractId?: string; tenantProfileId?: string }
  ): Promise<{ receipts: Receipt[]; total: number }> {
    const { page, limit, search, sortBy, sortOrder, contractId, tenantProfileId } = options;
    const skip = (page - 1) * limit;

    const where: Prisma.ReceiptWhereInput = {
      organizationId,
      contractId: contractId || undefined,
      tenantProfileId: tenantProfileId || undefined,
      OR: search
        ? [
            { receiptNumber: { contains: search, mode: 'insensitive' } },
            { tenantProfile: { firstName: { contains: search, mode: 'insensitive' } } },
            { tenantProfile: { lastName: { contains: search, mode: 'insensitive' } } },
          ]
        : undefined,
    };

    const [receipts, total] = await Promise.all([
      prisma.receipt.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy || 'createdAt']: (sortOrder || 'ASC').toLowerCase() as 'asc' | 'desc' },
        include: {
          contract: { select: { contractNumber: true } },
          property: { select: { name: true, type: true } },
          tenantProfile: { select: { firstName: true, lastName: true } },
        },
      }),
      prisma.receipt.count({ where }),
    ]);

    return { receipts, total };
  }

  async findById(id: string, organizationId: string): Promise<Receipt | null> {
    return prisma.receipt.findFirst({
      where: { id, organizationId },
      include: {
        payment: true,
        contract: { include: { property: true } },
        tenantProfile: true,
        property: true,
      },
    });
  }

  async findByPaymentId(paymentId: string): Promise<Receipt | null> {
    return prisma.receipt.findFirst({
      where: { paymentId },
    });
  }

  async create(data: Prisma.ReceiptUncheckedCreateInput): Promise<Receipt> {
    return prisma.receipt.create({
      data,
    });
  }

  async verify(receiptNumber: string, digitalSignature: string): Promise<Receipt | null> {
    return prisma.receipt.findFirst({
      where: {
        receiptNumber,
        digitalSignature,
      },
      include: {
        tenantProfile: { select: { firstName: true, lastName: true } },
        property: { select: { name: true, address: true, city: true } },
      },
    });
  }
}

export const receiptsRepository = new ReceiptsRepository();
