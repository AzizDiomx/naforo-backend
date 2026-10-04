import { documentsRepository } from './documents.repository';
import { NotFoundError, BadRequestError } from '@/shared/errors/AppError';
import { Document } from '@prisma/client';
import path from 'path';
import fs from 'fs';

export class DocumentsService {
  async getAllDocuments(
    organizationId: string,
    entityType?: string,
    entityId?: string
  ): Promise<Document[]> {
    return documentsRepository.findAll(organizationId, entityType, entityId);
  }

  async uploadDocument(
    file: Express.Multer.File,
    entityType: string,
    entityId: string,
    organizationId: string,
    uploadedBy: string
  ): Promise<Document> {
    if (!file) {
      throw new BadRequestError('Aucun fichier fourni pour le téléversement.');
    }

    const fileUrl = `/uploads/${file.filename}`;

    return documentsRepository.create({
      organizationId,
      entityType,
      entityId,
      name: file.originalname,
      type: file.mimetype.startsWith('image/') ? 'image' : 'pdf',
      fileUrl,
      fileSize: file.size,
      mimeType: file.mimetype,
      uploadedBy,
    });
  }

  async deleteDocument(id: string, organizationId: string): Promise<void> {
    const doc = await documentsRepository.findById(id, organizationId);
    if (!doc) {
      throw new NotFoundError('Document introuvable.');
    }

    // 1. Delete DB entry
    await documentsRepository.delete(id);

    // 2. Delete physical file from uploads folder
    const filename = path.basename(doc.fileUrl);
    const filepath = path.join(process.cwd(), 'uploads', filename);

    try {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
    } catch (error) {
      // Log error but do not fail request if file deletion fails
      console.error(`Failed to delete physical file: ${filepath}`, error);
    }
  }
}

export const documentsService = new DocumentsService();
