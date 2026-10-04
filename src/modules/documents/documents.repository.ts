import { prisma } from '@/config/database';
import { Document, Prisma } from '@prisma/client';

export class DocumentsRepository {
  async findAll(organizationId: string, entityType?: string, entityId?: string): Promise<Document[]> {
    return prisma.document.findMany({
      where: {
        organizationId,
        entityType: entityType || undefined,
        entityId: entityId || undefined,
      },
      include: {
        uploader: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string, organizationId: string): Promise<Document | null> {
    return prisma.document.findFirst({
      where: { id, organizationId },
    });
  }

  async create(data: Prisma.DocumentUncheckedCreateInput): Promise<Document> {
    return prisma.document.create({
      data,
    });
  }

  async delete(id: string): Promise<Document> {
    return prisma.document.delete({
      where: { id },
    });
  }
}

export const documentsRepository = new DocumentsRepository();
