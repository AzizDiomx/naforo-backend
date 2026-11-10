import { prisma } from '@/config/database';
import { buildPaginationMeta } from '@/shared/helpers/pagination';

export interface CreateWhatsAppLogInput {
  organizationId: string;
  recipientPhone: string;
  recipientName?: string | null;
  templateType: string;
  messageContent: string;
  status: string;
  relatedEntity?: string | null;
  relatedId?: string | null;
  sentById?: string | null;
}

export interface WhatsAppLogQueryOptions {
  page?: number;
  limit?: number;
  templateType?: string;
  status?: string;
  search?: string;
  relatedEntity?: string;
}

export const whatsappRepository = {
  async createLog(data: CreateWhatsAppLogInput) {
    return prisma.whatsAppLog.create({
      data: {
        organizationId: data.organizationId,
        recipientPhone: data.recipientPhone,
        recipientName: data.recipientName,
        templateType: data.templateType,
        messageContent: data.messageContent,
        status: data.status,
        relatedEntity: data.relatedEntity,
        relatedId: data.relatedId,
        sentById: data.sentById,
      },
    });
  },

  async findLogs(organizationId: string, options: WhatsAppLogQueryOptions = {}) {
    const page = options.page || 1;
    const limit = options.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { organizationId };

    if (options.templateType) {
      where.templateType = options.templateType;
    }
    if (options.status) {
      where.status = options.status;
    }
    if (options.relatedEntity) {
      where.relatedEntity = options.relatedEntity;
    }
    if (options.search) {
      where.OR = [
        { recipientName: { contains: options.search, mode: 'insensitive' } },
        { recipientPhone: { contains: options.search, mode: 'insensitive' } },
        { messageContent: { contains: options.search, mode: 'insensitive' } },
      ];
    }

    const [total, data] = await Promise.all([
      prisma.whatsAppLog.count({ where }),
      prisma.whatsAppLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  },

  async getStats(organizationId: string) {
    const [total, sent, delivered, directLink] = await Promise.all([
      prisma.whatsAppLog.count({ where: { organizationId } }),
      prisma.whatsAppLog.count({ where: { organizationId, status: 'sent' } }),
      prisma.whatsAppLog.count({ where: { organizationId, status: 'delivered' } }),
      prisma.whatsAppLog.count({ where: { organizationId, status: 'direct_link_opened' } }),
    ]);

    return { total, sent, delivered, directLink };
  },
};
