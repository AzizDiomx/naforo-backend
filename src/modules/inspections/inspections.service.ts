import { inspectionsRepository } from './inspections.repository';
import { prisma } from '@/config/database';
import { NotFoundError, BadRequestError } from '@/shared/errors/AppError';
import { PropertyInspection } from '@prisma/client';
import { generateEdlPdf } from './edl.pdf';
import { saveFileToDatabase } from '@/shared/helpers/file-storage';
import { PaginationQuery, PaginationMeta } from '@/shared/types';
import { buildPaginationMeta } from '@/shared/helpers/pagination';
import { logger } from '@/config/logger';

export class InspectionsService {
  /**
   * Génère un numéro de référence unique format : EDL-2026-0042
   */
  private async generateInspectionNumber(organizationId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await prisma.propertyInspection.count({
      where: { organizationId },
    });
    const seq = String(count + 1).padStart(4, '0');
    return `EDL-${year}-${seq}`;
  }

  async getAllInspections(
    organizationId: string,
    query: PaginationQuery & {
      type?: string;
      status?: string;
      propertyId?: string;
      contractId?: string;
      tenantProfileId?: string;
    }
  ): Promise<{ data: PropertyInspection[]; meta: PaginationMeta }> {
    const { inspections, total } = await inspectionsRepository.findAll(organizationId, query);
    const meta = buildPaginationMeta(total, query.page, query.limit);
    return { data: inspections, meta };
  }

  async getInspectionById(id: string, organizationId: string): Promise<PropertyInspection> {
    const inspection = await inspectionsRepository.findById(id, organizationId);
    if (!inspection) {
      throw new NotFoundError("État des lieux introuvable ou n'appartenant pas à votre organisation.");
    }
    return inspection;
  }

  async createInspection(data: any, organizationId: string, inspectorUserId?: string): Promise<PropertyInspection> {
    // 1. Vérifier l'appartenance du bien immobilier
    const property = await prisma.property.findFirst({
      where: { id: data.propertyId, organizationId },
    });
    if (!property) {
      throw new NotFoundError('Bien immobilier introuvable dans votre organisation.');
    }

    // 2. Si un contrat est spécifié, vérifier et récupérer le locataire
    let tenantProfileId = data.tenantProfileId;
    if (data.contractId) {
      const contract = await prisma.contract.findFirst({
        where: { id: data.contractId, organizationId },
      });
      if (contract && !tenantProfileId) {
        tenantProfileId = contract.tenantProfileId;
      }
    }

    // 3. Récupérer le nom de l'inspecteur
    let inspectorName = data.inspectorName;
    if (!inspectorName && inspectorUserId) {
      const user = await prisma.user.findUnique({ where: { id: inspectorUserId } });
      if (user) {
        inspectorName = `${user.firstName} ${user.lastName}`;
      }
    }

    const inspectionNumber = await this.generateInspectionNumber(organizationId);

    const inspection = await inspectionsRepository.create({
      inspectionNumber,
      type: data.type,
      status: 'draft',
      organizationId,
      propertyId: data.propertyId,
      contractId: data.contractId || null,
      tenantProfileId: tenantProfileId || null,
      inspectorId: inspectorUserId || null,
      inspectorName: inspectorName || null,
      inspectionDate: data.inspectionDate ? new Date(data.inspectionDate) : new Date(),
      meterReadings: data.meterReadings || {},
      roomsData: data.roomsData || [],
      generalObservations: data.generalObservations || null,
      estimatedDeductionAmount: data.estimatedDeductionAmount ? Number(data.estimatedDeductionAmount) : 0,
      deductionDetails: data.deductionDetails || null,
    });

    // 4. Générer le document PDF initial
    try {
      const fullInspection = await inspectionsRepository.findById(inspection.id, organizationId);
      const pdf = await generateEdlPdf({
        inspection: fullInspection,
        organization: fullInspection?.organization,
        property: fullInspection?.property,
        tenant: fullInspection?.tenantProfile,
        inspector: fullInspection?.inspector,
      });

      await saveFileToDatabase(
        `${inspection.inspectionNumber}.pdf`,
        pdf.absolutePath,
        'application/pdf',
        `${inspection.inspectionNumber}.pdf`
      );

      return await inspectionsRepository.update(inspection.id, { pdfUrl: pdf.relativePath });
    } catch (err) {
      logger.error("Erreur génération PDF État des Lieux lors de la création:", err);
      return inspection;
    }
  }

  async updateInspection(id: string, data: any, organizationId: string): Promise<PropertyInspection> {
    await this.getInspectionById(id, organizationId);

    const updated = await inspectionsRepository.update(id, {
      type: data.type,
      status: data.status,
      propertyId: data.propertyId,
      contractId: data.contractId || null,
      tenantProfileId: data.tenantProfileId || null,
      inspectorName: data.inspectorName,
      inspectionDate: data.inspectionDate ? new Date(data.inspectionDate) : undefined,
      meterReadings: data.meterReadings !== undefined ? data.meterReadings : undefined,
      roomsData: data.roomsData !== undefined ? data.roomsData : undefined,
      generalObservations: data.generalObservations,
      estimatedDeductionAmount: data.estimatedDeductionAmount !== undefined ? Number(data.estimatedDeductionAmount) : undefined,
      deductionDetails: data.deductionDetails,
    });

    // Régénérer le PDF
    try {
      const fullInspection = await inspectionsRepository.findById(id, organizationId);
      const pdf = await generateEdlPdf({
        inspection: fullInspection,
        organization: fullInspection?.organization,
        property: fullInspection?.property,
        tenant: fullInspection?.tenantProfile,
        inspector: fullInspection?.inspector,
      });
      await saveFileToDatabase(
        `${fullInspection!.inspectionNumber}.pdf`,
        pdf.absolutePath,
        'application/pdf',
        `${fullInspection!.inspectionNumber}.pdf`
      );
      return await inspectionsRepository.update(id, { pdfUrl: pdf.relativePath });
    } catch (e) {
      return updated;
    }
  }

  async signInspection(
    id: string,
    organizationId: string,
    signerRole: 'inspector' | 'tenant',
    signature: string
  ): Promise<PropertyInspection> {
    const existing = await this.getInspectionById(id, organizationId);

    const now = new Date();
    const updateData: any = {};

    if (signerRole === 'inspector') {
      updateData.inspectorSignature = signature;
      updateData.inspectorSignedAt = now;
    } else {
      updateData.tenantSignature = signature;
      updateData.tenantSignedAt = now;
    }

    // Si les deux signatures sont désormais réunies (ou déjà présentes)
    const hasBothSignatures =
      (signerRole === 'inspector' && existing.tenantSignedAt) ||
      (signerRole === 'tenant' && existing.inspectorSignedAt) ||
      (existing.inspectorSignedAt && existing.tenantSignedAt);

    if (hasBothSignatures) {
      updateData.status = 'signed';
    } else {
      updateData.status = 'completed';
    }

    const updated = await inspectionsRepository.update(id, updateData);

    // Régénérer le PDF avec les signatures apposées
    try {
      const full = await inspectionsRepository.findById(id, organizationId);
      const pdf = await generateEdlPdf({
        inspection: full,
        organization: full?.organization,
        property: full?.property,
        tenant: full?.tenantProfile,
        inspector: full?.inspector,
      });
      await saveFileToDatabase(`${full!.inspectionNumber}.pdf`, pdf.absolutePath, 'application/pdf');
      return await inspectionsRepository.update(id, { pdfUrl: pdf.relativePath });
    } catch (err) {
      return updated;
    }
  }

  /**
   * Comparatif automatique État des Lieux Entrée vs Sortie
   * Détecte les dégradations pièce par pièce pour justifier les retenues sur caution.
   */
  async compareInspections(contractId: string, organizationId: string): Promise<any> {
    const entry = await inspectionsRepository.findByContractAndType(contractId, 'entry', organizationId);
    const exit = await inspectionsRepository.findByContractAndType(contractId, 'exit', organizationId);

    if (!entry) {
      throw new NotFoundError("Aucun état des lieux d'entrée n'a été trouvé pour ce contrat de bail.");
    }

    const entryRooms: any[] = Array.isArray(entry.roomsData) ? entry.roomsData : [];
    const exitRooms: any[] = exit && Array.isArray(exit.roomsData) ? exit.roomsData : [];

    const conditionScores: Record<string, number> = {
      neuf: 4,
      bon: 3,
      usage: 2,
      mauvais: 1,
    };

    const differences: any[] = [];

    // Parcourir les pièces de l'EDL d'entrée
    for (const entryRoom of entryRooms) {
      const exitRoom = exitRooms.find((r: any) => r.roomName.trim().toLowerCase() === entryRoom.roomName.trim().toLowerCase());

      const elementsDiff: any[] = [];
      const entryElements: any[] = Array.isArray(entryRoom.elements) ? entryRoom.elements : [];
      const exitElements: any[] = exitRoom && Array.isArray(exitRoom.elements) ? exitRoom.elements : [];

      for (const entryEl of entryElements) {
        const exitEl = exitElements.find((e: any) => e.name.trim().toLowerCase() === entryEl.name.trim().toLowerCase());

        const scoreEntry = conditionScores[entryEl.condition] || 3;
        const scoreExit = exitEl ? (conditionScores[exitEl.condition] || 3) : null;

        const isDegraded = scoreExit !== null && scoreExit < scoreEntry;

        elementsDiff.push({
          name: entryEl.name,
          entryCondition: entryEl.condition,
          entryComment: entryEl.comment,
          exitCondition: exitEl ? exitEl.condition : 'Non inspecté',
          exitComment: exitEl ? exitEl.comment : null,
          isDegraded,
        });
      }

      differences.push({
        roomName: entryRoom.roomName,
        entryRoomCondition: entryRoom.condition,
        exitRoomCondition: exitRoom ? exitRoom.condition : 'Non inspecté',
        elements: elementsDiff,
      });
    }

    return {
      contractId,
      entryInspection: {
        id: entry.id,
        inspectionNumber: entry.inspectionNumber,
        inspectionDate: entry.inspectionDate,
        status: entry.status,
      },
      exitInspection: exit
        ? {
            id: exit.id,
            inspectionNumber: exit.inspectionNumber,
            inspectionDate: exit.inspectionDate,
            status: exit.status,
            estimatedDeductionAmount: exit.estimatedDeductionAmount,
          }
        : null,
      comparison: differences,
      hasExitReport: Boolean(exit),
    };
  }

  async deleteInspection(id: string, organizationId: string): Promise<void> {
    await this.getInspectionById(id, organizationId);
    await inspectionsRepository.delete(id, organizationId);
  }
}

export const inspectionsService = new InspectionsService();
