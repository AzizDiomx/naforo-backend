import { invoicesRepository } from './invoices.repository';
import { prisma } from '@/config/database';
import { NotFoundError, BadRequestError } from '@/shared/errors/AppError';
import { Invoice } from '@prisma/client';
import { getDueDate, formatDate, formatCurrency, getMonthName } from '@/shared/helpers/date';
import { emailQueue } from '@/queues';
import { logger } from '@/config/logger';
import path from 'path';
import fs from 'fs';
import os from 'os';
import PDFDocument from 'pdfkit';
import { PaginationQuery, PaginationMeta } from '@/shared/types';
import { buildPaginationMeta } from '@/shared/helpers/pagination';

export class InvoicesService {
  /**
   * Synchronise et met à jour automatiquement les factures dont l'échéance est dépassée.
   */
  async checkAndUpdateOverdueInvoices(organizationId?: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const overdueInvoices = await prisma.invoice.findMany({
      where: {
        organizationId: organizationId || undefined,
        status: { in: ['pending', 'partial'] },
        dueDate: { lt: today },
      },
      select: { id: true },
    });

    if (overdueInvoices.length > 0) {
      await prisma.invoice.updateMany({
        where: {
          id: { in: overdueInvoices.map((i) => i.id) },
        },
        data: {
          status: 'overdue',
        },
      });
      logger.info(`Updated ${overdueInvoices.length} invoices to 'overdue' status.`);
    }

    return overdueInvoices.length;
  }

  async getAllInvoices(
    organizationId: string,
    query: PaginationQuery & {
      status?: string;
      contractId?: string;
      propertyId?: string;
      tenantProfileId?: string;
      month?: number;
      year?: number;
    }
  ): Promise<{ data: any[]; meta: PaginationMeta }> {
    // 1. Mise à jour automatique des retards
    await this.checkAndUpdateOverdueInvoices(organizationId);

    // 2. Récupération des factures
    const { invoices, total } = await invoicesRepository.findAll(organizationId, query);

    // 3. Calcul dynamique du montant payé et du solde restant dû
    const enrichedInvoices = invoices.map((inv: any) => {
      const validatedPayments = inv.payments || [];
      const paidAmount = validatedPayments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
      const totalAmount = Number(inv.totalAmount);
      const remainingAmount = Math.max(0, totalAmount - paidAmount);

      return {
        ...inv,
        paidAmount,
        remainingAmount,
      };
    });

    const meta = buildPaginationMeta(total, query.page, query.limit);
    return { data: enrichedInvoices, meta };
  }

  async getInvoiceById(id: string, organizationId: string): Promise<any> {
    await this.checkAndUpdateOverdueInvoices(organizationId);

    const invoice = await invoicesRepository.findById(id, organizationId);
    if (!invoice) {
      throw new NotFoundError('Facture introuvable.');
    }

    if (!invoice.pdfUrl) {
      try {
        const pdfUrl = await this.generateInvoicePDF(invoice.id);
        invoice.pdfUrl = pdfUrl;
      } catch (e) {}
    }

    const validatedPayments = (invoice.payments || []).filter((p: any) => p.status === 'validated');
    const paidAmount = validatedPayments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
    const totalAmount = Number(invoice.totalAmount);
    const remainingAmount = Math.max(0, totalAmount - paidAmount);

    return {
      ...invoice,
      paidAmount,
      remainingAmount,
    };
  }

  async createInvoice(data: any, organizationId: string): Promise<Invoice> {
    const periodMonth = Number(data.periodMonth);
    const periodYear = Number(data.periodYear);

    // Vérifier l'absence de doublon actif
    const exists = await invoicesRepository.existsForPeriod(data.contractId, periodMonth, periodYear);
    if (exists) {
      throw new BadRequestError('Une facture active a déjà été émise pour ce contrat de bail sur cette période.');
    }

    const contract = await prisma.contract.findFirst({
      where: { id: data.contractId, organizationId },
    });

    if (!contract) {
      throw new NotFoundError('Contrat de bail introuvable.');
    }

    const rentAmount = Number(data.rentAmount !== undefined ? data.rentAmount : contract.rentAmount);
    const chargesAmount = Number(data.chargesAmount !== undefined ? data.chargesAmount : (contract.chargesAmount || 0));
    const penaltyAmount = Number(data.penaltyAmount || 0);
    const totalAmount = rentAmount + chargesAmount + penaltyAmount;

    const timestamp = Date.now().toString();
    const invoiceNumber = data.invoiceNumber || `INV-${periodYear}${String(periodMonth).padStart(2, '0')}-${timestamp.slice(-6)}`;

    const dueDate = data.dueDate
      ? new Date(data.dueDate)
      : getDueDate(contract.paymentDay || 5, periodMonth, periodYear);

    const invoice = await invoicesRepository.create({
      invoiceNumber,
      organizationId,
      contractId: data.contractId,
      periodMonth,
      periodYear,
      dueDate,
      rentAmount,
      chargesAmount,
      penaltyAmount,
      totalAmount,
      tenantProfileId: contract.tenantProfileId,
      propertyId: contract.propertyId,
      status: 'pending',
    });

    // Génération PDF synchrone
    try {
      const pdfUrl = await this.generateInvoicePDF(invoice.id);
      invoice.pdfUrl = pdfUrl;
    } catch (err) {
      logger.error(`Error generating PDF for invoice ${invoice.id}`, err);
    }

    return invoice;
  }

  /**
   * Génération intelligente et automatisée des factures de loyer du mois.
   * - Vérifie l'éligibilité des baux actifs
   * - Calcule le prorata temporis d'entrée si le bail démarre en cours de mois
   * - Empêche strictement les doublons
   */
  async generateMonthlyInvoices(organizationId?: string): Promise<{ generatedCount: number; skippedCount: number }> {
    const today = new Date();
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();

    // Délimitation temporelle du mois en cours
    const startOfPeriod = new Date(currentYear, currentMonth - 1, 1);
    const endOfPeriod = new Date(currentYear, currentMonth, 0, 23, 59, 59, 999);
    const daysInCurrentMonth = new Date(currentYear, currentMonth, 0).getDate();

    logger.info(`Running smart monthly invoices generation for ${currentMonth}/${currentYear}...`);

    // 1. Récupération des contrats actifs dans l'organisation
    const contracts = await prisma.contract.findMany({
      where: {
        status: 'active',
        organizationId: organizationId || undefined,
      },
    });

    let generatedCount = 0;
    let skippedCount = 0;

    for (const contract of contracts) {
      const contractStart = new Date(contract.startDate);
      const contractEnd = contract.endDate ? new Date(contract.endDate) : null;

      // A. Le contrat n'a pas encore commencé pour ce mois
      if (contractStart > endOfPeriod) {
        skippedCount++;
        continue;
      }

      // B. Le contrat est déjà terminé avant le début de ce mois
      if (contractEnd && contractEnd < startOfPeriod) {
        skippedCount++;
        continue;
      }

      // C. Doublon déjà existant (hors annulé)
      const exists = await invoicesRepository.existsForPeriod(contract.id, currentMonth, currentYear);
      if (exists) {
        skippedCount++;
        continue;
      }

      // D. Calcul des montants avec prorata d'entrée si applicable
      let rentAmount = Number(contract.rentAmount);
      let chargesAmount = Number(contract.chargesAmount || 0);

      // Si le bail commence durant le mois en cours
      if (contractStart > startOfPeriod && contractStart.getMonth() + 1 === currentMonth && contractStart.getFullYear() === currentYear) {
        const activeDays = daysInCurrentMonth - contractStart.getDate() + 1;
        const prorataRatio = Math.max(0.01, activeDays / daysInCurrentMonth);
        rentAmount = Math.round(rentAmount * prorataRatio);
        chargesAmount = Math.round(chargesAmount * prorataRatio);
        logger.info(`Applied entry prorata for contract ${contract.contractNumber}: ${activeDays}/${daysInCurrentMonth} days.`);
      }

      const totalAmount = rentAmount + chargesAmount;
      const dueDate = getDueDate(contract.paymentDay || 5, currentMonth, currentYear);
      const timestamp = Date.now().toString();
      const invoiceNumber = `INV-${currentYear}${String(currentMonth).padStart(2, '0')}-${timestamp.slice(-6)}`;

      const invoice = await invoicesRepository.create({
        invoiceNumber,
        organizationId: contract.organizationId,
        contractId: contract.id,
        tenantProfileId: contract.tenantProfileId,
        propertyId: contract.propertyId,
        periodMonth: currentMonth,
        periodYear: currentYear,
        dueDate,
        rentAmount,
        chargesAmount,
        penaltyAmount: 0,
        totalAmount,
        status: 'pending',
      });

      // Génération PDF silencieuse
      try {
        await this.generateInvoicePDF(invoice.id);
      } catch (err) {}

      generatedCount++;
    }

    logger.info(`Monthly invoices generation complete. Generated: ${generatedCount}, Skipped: ${skippedCount}.`);
    return { generatedCount, skippedCount };
  }

  /**
   * Annuler une facture (ex: erreur de facturation ou régularisation)
   */
  async cancelInvoice(id: string, reason: string, organizationId: string): Promise<Invoice> {
    const invoice = await this.getInvoiceById(id, organizationId);

    if (invoice.status === 'paid') {
      throw new BadRequestError('Une facture déjà payée et acquittée ne peut pas être annulée directement.');
    }

    return invoicesRepository.update(id, {
      status: 'cancelled',
    });
  }

  /**
   * Générateur de PDF professionnel Naforo avec charte graphique élégante (#013E37)
   */
  async generateInvoicePDF(invoiceId: string): Promise<string> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        contract: true,
        tenantProfile: true,
        property: true,
        organization: true,
        payments: { where: { status: 'validated' } },
      },
    });

    if (!invoice) {
      throw new NotFoundError('Invoice not found for PDF generation');
    }

    const pdfName = `${invoice.invoiceNumber}.pdf`;
    const relativePath = `/uploads/invoices/${pdfName}`;
    const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
    const invoicesDir = isServerless
      ? path.join(os.tmpdir(), 'uploads', 'invoices')
      : path.join(process.cwd(), 'uploads', 'invoices');

    try {
      if (!fs.existsSync(invoicesDir)) {
        fs.mkdirSync(invoicesDir, { recursive: true });
      }
    } catch (_) {}

    const absolutePath = path.join(invoicesDir, pdfName);

    // Setup PDFKit document
    const doc = new PDFDocument({ margin: 50 });
    const writeStream = fs.createWriteStream(absolutePath);
    doc.pipe(writeStream);

    // 1. Header (Naforo Branding & Logo) - Vert Forêt Émeraude (#013E37)
    doc.fillColor('#013E37').fontSize(24).font('Helvetica-Bold').text('Naforo', 50, 45);
    doc.fillColor('#64748b').fontSize(9).font('Helvetica').text('Plateforme Intelligente de Gestion Locative', 50, 70);

    // Organization info
    doc.fillColor('#0f172a').fontSize(10).font('Helvetica-Bold').text(invoice.organization.name, 400, 45, { align: 'right' });
    if (invoice.organization.phone) {
      doc.font('Helvetica').fontSize(9).fillColor('#475569').text(`Tél : ${invoice.organization.phone}`, 400, 60, { align: 'right' });
    }
    if (invoice.organization.email) {
      doc.text(`Email : ${invoice.organization.email}`, 400, 72, { align: 'right' });
    }

    doc.moveDown(2);
    doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, 95).lineTo(550, 95).stroke();

    // 2. Invoice Meta Details
    doc.moveDown(1.5);
    doc.fillColor('#013E37').fontSize(14).font('Helvetica-Bold').text(`AVIS D'ÉCHÉANCE / FACTURE N° ${invoice.invoiceNumber}`);
    doc.fillColor('#475569').fontSize(10).font('Helvetica').text(`Date d'émission : ${formatDate(invoice.createdAt)}`);
    doc.fillColor('#dc2626').font('Helvetica-Bold').text(`Date limite de paiement : ${formatDate(invoice.dueDate)}`);

    // 3. Addresses Column
    doc.moveDown(2);
    const topY = doc.y;

    // Tenant info
    doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold').text('LOCATAIRE (DESTINATAIRE)', 50, topY);
    doc.fillColor('#475569').fontSize(10).font('Helvetica').text(`${invoice.tenantProfile.firstName} ${invoice.tenantProfile.lastName}`);
    doc.text(`Tél : ${invoice.tenantProfile.phone}`);
    if (invoice.tenantProfile.email) doc.text(`Email : ${invoice.tenantProfile.email}`);

    // Property info
    doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold').text('LOGEMENT LOUÉ', 320, topY);
    doc.fillColor('#475569').fontSize(10).font('Helvetica').text(`Bien : ${invoice.property.name}`);
    doc.text(`Type : ${invoice.property.type.toUpperCase()}`);
    doc.text(`Adresse : ${invoice.property.address}, ${invoice.property.city}`);

    // 4. Period details
    doc.moveDown(3.5);
    doc.fillColor('#013E37').fontSize(11).font('Helvetica-Bold').text(`Période concernée : ${getMonthName(invoice.periodMonth, invoice.periodYear)}`);
    doc.moveDown(0.5);

    // 5. Invoice Items Table
    const tableTop = doc.y;
    doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(50, tableTop).lineTo(550, tableTop).stroke();
    
    // Table Header
    doc.moveDown(0.5);
    doc.fillColor('#0f172a').font('Helvetica-Bold');
    doc.text('Désignation des prestations', 60, doc.y, { width: 300 });
    doc.text('Montant (FCFA)', 400, doc.y - 12, { align: 'right', width: 140 });
    doc.moveDown(0.5);
    doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();

    // Base Rent Line
    doc.moveDown(0.8);
    doc.font('Helvetica').fillColor('#334155');
    doc.text('Loyer mensuel du logement', 60, doc.y);
    doc.text(formatCurrency(Number(invoice.rentAmount)), 400, doc.y - 12, { align: 'right', width: 140 });
    doc.moveDown(0.5);

    // Charges Line
    if (Number(invoice.chargesAmount) > 0) {
      doc.text('Charges locatives forfaitaires (entretien, gardiennage, eau/énergie)', 60, doc.y);
      doc.text(formatCurrency(Number(invoice.chargesAmount)), 400, doc.y - 12, { align: 'right', width: 140 });
      doc.moveDown(0.5);
    }

    // Penalties Line
    if (Number(invoice.penaltyAmount) > 0) {
      doc.fillColor('#dc2626');
      doc.text('Pénalités de retard applicables', 60, doc.y);
      doc.text(formatCurrency(Number(invoice.penaltyAmount)), 400, doc.y - 12, { align: 'right', width: 140 });
      doc.fillColor('#334155');
      doc.moveDown(0.5);
    }

    doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(1);

    // Total Section
    doc.fillColor('#013E37').font('Helvetica-Bold').fontSize(12);
    doc.text('TOTAL NET À PAYER :', 220, doc.y);
    doc.text(formatCurrency(Number(invoice.totalAmount)), 400, doc.y - 14, { align: 'right', width: 140 });

    // Status Stamp
    if (invoice.status === 'paid') {
      doc.moveDown(1.5);
      doc.fillColor('#16a34a').font('Helvetica-Bold').fontSize(14).text('*** FACTURE INTÉGRALEMENT RÉGLÉE ET ACQUITTÉE ***', 50, doc.y, { align: 'center' });
    }

    // 6. Payment Modes / Footnotes
    doc.moveDown(2.5);
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#013E37').text('Canaux de règlement acceptés :', 50, doc.y);
    doc.font('Helvetica').fillColor('#475569');
    doc.text('- Mobile Money : Wave, Orange Money, MTN Moov');
    doc.text('- Virement bancaire ou règlement sécurisé en agence');
    doc.moveDown(1);
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#94a3b8').text('Veuillez déclarer votre preuve de paiement sur votre portail Naforo dès la transaction réalisée.', 50, doc.y, { align: 'center' });

    doc.end();

    // Wait for write stream to finish
    await new Promise<boolean>((resolve, reject) => {
      writeStream.on('finish', () => resolve(true));
      writeStream.on('error', reject);
    });

    // Update pdfUrl in database
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { pdfUrl: relativePath },
    });

    return relativePath;
  }

  async sendInvoiceEmail(invoiceId: string): Promise<void> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { tenantProfile: true, organization: true },
    });

    if (!invoice || !invoice.tenantProfile.email) return;

    const attachmentPath = path.join(process.cwd(), 'uploads', 'invoices', `${invoice.invoiceNumber}.pdf`);

    await emailQueue.add('send-email', {
      to: invoice.tenantProfile.email,
      subject: `Avis d'échéance de loyer N° ${invoice.invoiceNumber} - Naforo`,
      html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #013E37;">Avis d'Échéance de Loyer - Naforo</h2>
        <p>Bonjour ${invoice.tenantProfile.firstName},</p>
        <p>Votre facture pour la période de <strong>${getMonthName(invoice.periodMonth, invoice.periodYear)}</strong> est désormais disponible.</p>
        <div style="background-color: #f8fafc; padding: 16px; border-radius: 6px; margin: 20px 0; border: 1px solid #e2e8f0;">
          <table style="width: 100%; font-size: 14px;">
            <tr><td><strong>Facture :</strong></td><td style="text-align: right;">${invoice.invoiceNumber}</td></tr>
            <tr><td><strong>Montant Total :</strong></td><td style="text-align: right; font-weight: bold; color: #013E37;">${formatCurrency(Number(invoice.totalAmount))}</td></tr>
            <tr><td><strong>Date Limite :</strong></td><td style="text-align: right; color: #dc2626; font-weight: bold;">${formatDate(invoice.dueDate)}</td></tr>
          </table>
        </div>
        <p>Votre facture complète est disponible au format PDF en pièce jointe. Veuillez régler votre loyer et enregistrer la référence de paiement sur votre espace locataire.</p>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="font-size: 11px; color: #94a3b8; text-align: center;">Document généré automatiquement par Naforo pour ${invoice.organization.name}</p>
      </div>`,
      attachments: [
        {
          filename: `${invoice.invoiceNumber}.pdf`,
          path: attachmentPath,
        }
      ]
    });
  }
}

export const invoicesService = new InvoicesService();
export default invoicesService;
