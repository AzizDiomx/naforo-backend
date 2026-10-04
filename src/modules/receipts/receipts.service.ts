import { receiptsRepository } from './receipts.repository';
import { prisma } from '@/config/database';
import { NotFoundError, BadRequestError } from '@/shared/errors/AppError';
import { Receipt } from '@prisma/client';
import { env } from '@/config/env';
import { signData } from '@/shared/helpers/crypto';
import { formatDate, formatCurrency, getMonthName } from '@/shared/helpers/date';
import { pdfQueue, emailQueue } from '@/queues';
import { logger } from '@/config/logger';
import path from 'path';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { PaginationQuery, PaginationMeta } from '@/shared/types';
import { buildPaginationMeta } from '@/shared/helpers/pagination';

export class ReceiptsService {
  async getAllReceipts(
    organizationId: string,
    query: PaginationQuery & { contractId?: string; tenantProfileId?: string }
  ): Promise<{ data: Receipt[]; meta: PaginationMeta }> {
    const { receipts, total } = await receiptsRepository.findAll(organizationId, query);
    const meta = buildPaginationMeta(total, query.page, query.limit);
    return { data: receipts, meta };
  }

  async getReceiptById(id: string, organizationId: string): Promise<Receipt> {
    const receipt = await receiptsRepository.findById(id, organizationId);
    if (!receipt) {
      throw new NotFoundError('Quittance introuvable.');
    }
    if (!receipt.pdfUrl) {
      try {
        const pdfUrl = await this.generateReceiptPDF(receipt.id);
        receipt.pdfUrl = pdfUrl;
      } catch (e) {}
    }
    return receipt;
  }

  async generateReceipt(paymentId: string, organizationId: string): Promise<Receipt> {
    // 1. Check if receipt already exists for this payment
    const existing = await receiptsRepository.findByPaymentId(paymentId);
    if (existing) {
      return existing;
    }

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        contract: { include: { property: true } },
        tenantProfile: true,
        invoice: true,
      },
    });

    if (!payment || payment.organizationId !== organizationId) {
      throw new NotFoundError('Paiement introuvable.');
    }

    // Determine exact rent period from linked invoice or fallback to payment date
    let periodMonth = payment.invoice ? payment.invoice.periodMonth : (new Date(payment.paymentDate).getMonth() + 1);
    let periodYear = payment.invoice ? payment.invoice.periodYear : new Date(payment.paymentDate).getFullYear();

    const timestamp = Date.now().toString();
    const receiptNumber = `REC-${periodYear}${String(periodMonth).padStart(2, '0')}-${timestamp.slice(-4)}-${payment.paymentReference.replace(/[^a-zA-Z0-9]/g, '').slice(-4)}`;
    
    // Generate digital signature
    const signaturePayload = `${receiptNumber}|${payment.id}|${payment.amount}`;
    const digitalSignature = signData(signaturePayload, env.JWT_ACCESS_SECRET);

    // QR Code verifying URL
    const verifyUrl = `${env.APP_URL}${env.API_PREFIX}/receipts/verify/${receiptNumber}?sig=${digitalSignature}`;
    const qrCodeData = await QRCode.toDataURL(verifyUrl);

    const receipt = await receiptsRepository.create({
      organizationId,
      receiptNumber,
      paymentId,
      contractId: payment.contractId,
      tenantProfileId: payment.tenantProfileId,
      propertyId: payment.contract.propertyId,
      periodMonth,
      periodYear,
      amount: payment.amount,
      qrCodeData,
      digitalSignature,
    });

    // Generate PDF synchronously to guarantee immediate PDF availability
    try {
      const pdfUrl = await this.generateReceiptPDF(receipt.id);
      receipt.pdfUrl = pdfUrl;
    } catch (err) {
      logger.error(`Error generating PDF for receipt ${receipt.id}`, err);
    }

    return receipt;
  }

  async generateReceiptPDF(receiptId: string): Promise<string> {
    const receipt = await prisma.receipt.findUnique({
      where: { id: receiptId },
      include: {
        contract: true,
        tenantProfile: true,
        property: true,
        organization: true,
        payment: true,
      },
    });

    if (!receipt) {
      throw new NotFoundError('Receipt not found for PDF generation');
    }

    const pdfName = `${receipt.receiptNumber}.pdf`;
    const relativePath = `/uploads/receipts/${pdfName}`;
    const receiptsDir = path.join(process.cwd(), 'uploads', 'receipts');
    
    // Ensure receipts directory exists
    if (!fs.existsSync(receiptsDir)) {
      fs.mkdirSync(receiptsDir, { recursive: true });
    }

    const absolutePath = path.join(receiptsDir, pdfName);

    const doc = new PDFDocument({ margin: 50 });
    const writeStream = fs.createWriteStream(absolutePath);
    doc.pipe(writeStream);

    // 1. Header (Branding & Logo)
    doc.fillColor('#4f46e5').fontSize(24).font('Helvetica-Bold').text('Naforo', 50, 45);
    doc.fillColor('#6b7280').fontSize(9).font('Helvetica').text('Gestion Locative Intelligente', 50, 70);

    // Org info
    doc.fillColor('#1f2937').fontSize(10).font('Helvetica-Bold').text(receipt.organization.name, 400, 45, { align: 'right' });
    if (receipt.organization.phone) {
      doc.font('Helvetica').fontSize(9).fillColor('#4b5563').text(`Tel: ${receipt.organization.phone}`, 400, 60, { align: 'right' });
    }

    doc.moveDown(2);
    doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(50, 95).lineTo(550, 95).stroke();

    // 2. Title Section
    doc.moveDown(1.5);
    doc.fillColor('#1f2937').fontSize(16).font('Helvetica-Bold').text('QUITTANCE DE LOYER', { align: 'center' });
    doc.fillColor('#4b5563').fontSize(10).font('Helvetica').text(`Reçu N°: ${receipt.receiptNumber}`, { align: 'center' });
    doc.text(`Date d'émission: ${formatDate(receipt.issuedAt)}`, { align: 'center' });

    // 3. Landlord & Tenant details
    doc.moveDown(2);
    const topY = doc.y;

    // Bailleur Info
    doc.fillColor('#1f2937').fontSize(11).font('Helvetica-Bold').text('PROPRIÉTAIRE / GESTIONNAIRE', 50, topY);
    doc.fillColor('#4b5563').fontSize(10).font('Helvetica').text(receipt.organization.name);
    if (receipt.organization.address) doc.text(receipt.organization.address);
    if (receipt.organization.phone) doc.text(`Tel: ${receipt.organization.phone}`);

    // Locataire Info
    doc.fillColor('#1f2937').fontSize(11).font('Helvetica-Bold').text('LOCATAIRE', 320, topY);
    doc.fillColor('#4b5563').fontSize(10).font('Helvetica').text(`${receipt.tenantProfile.firstName} ${receipt.tenantProfile.lastName}`);
    doc.text(`Tel: ${receipt.tenantProfile.phone}`);
    doc.text(`Adresse du bien: ${receipt.property.name}, ${receipt.property.address}`);

    // 4. Declaration text
    doc.moveDown(3);
    doc.fillColor('#1f2937').fontSize(10).font('Helvetica');
    const declarationText = `Je soussigné, représentant légal de ${receipt.organization.name}, déclare avoir reçu de la part du locataire ${receipt.tenantProfile.firstName} ${receipt.tenantProfile.lastName}, la somme totale de ${formatCurrency(Number(receipt.amount))} au titre du paiement du loyer et des charges pour la période du mois de ${getMonthName(receipt.periodMonth, receipt.periodYear)}.`;
    doc.text(declarationText, { align: 'justify', lineGap: 4 });

    // 5. Breakdowns table
    doc.moveDown(2);
    const tableTop = doc.y;
    doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(50, tableTop).lineTo(550, tableTop).stroke();
    
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fillColor('#1f2937');
    doc.text('Détail du règlement', 60, doc.y);
    doc.text('Montant (FCFA)', 400, doc.y - 12, { align: 'right', width: 140 });
    doc.moveDown(0.5);
    doc.strokeColor('#d1d5db').lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();

    doc.moveDown(0.8);
    doc.font('Helvetica').fillColor('#4b5563');
    doc.text(`Loyer net principal`, 60, doc.y);
    doc.text(formatCurrency(Number(receipt.contract.rentAmount)), 400, doc.y - 12, { align: 'right', width: 140 });
    doc.moveDown(0.5);

    if (Number(receipt.contract.chargesAmount) > 0) {
      doc.text(`Charges forfaitaires associées`, 60, doc.y);
      doc.text(formatCurrency(Number(receipt.contract.chargesAmount)), 400, doc.y - 12, { align: 'right', width: 140 });
      doc.moveDown(0.5);
    }

    doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(1);

    // Sum Total
    doc.fillColor('#1f2937').font('Helvetica-Bold').fontSize(11);
    doc.text('TOTAL REÇU :', 250, doc.y);
    doc.text(formatCurrency(Number(receipt.amount)), 400, doc.y - 13, { align: 'right', width: 140 });

    // 6. QR Code validation & Digital signature
    doc.moveDown(2);
    const bottomY = doc.y;

    // Draw QR Code
    try {
      const qrBuffer = Buffer.from(receipt.qrCodeData.split(',')[1], 'base64');
      doc.image(qrBuffer, 50, bottomY, { width: 85, height: 85 });
      doc.fillColor('#9ca3af').fontSize(7).font('Helvetica-Oblique').text('Scannez ce QR Code pour vérifier l\'authenticité de la quittance sur Naforo.', 50, bottomY + 90, { width: 130 });
    } catch (err) {
      logger.error('Failed to embed QR code in PDF', err);
    }

    // Signature Block
    doc.fillColor('#1f2937').fontSize(10).font('Helvetica-Bold').text('Signature numérique Naforo', 320, bottomY);
    doc.fillColor('#4f46e5').fontSize(8).font('Courier').text(receipt.digitalSignature.slice(0, 32) + '...', 320, bottomY + 15, { width: 230 });
    doc.fillColor('#9ca3af').fontSize(8).font('Helvetica-Oblique').text('Ce document est certifié électroniquement.', 320, bottomY + 35);

    doc.end();

    await new Promise<boolean>((resolve, reject) => {
      writeStream.on('finish', () => resolve(true));
      writeStream.on('error', reject);
    });

    // Save path
    await prisma.receipt.update({
      where: { id: receiptId },
      data: { pdfUrl: relativePath },
    });

    // Queue email trigger to send receipt to tenant
    await emailQueue.add('send-receipt-email', { receiptId });

    return relativePath;
  }

  async sendReceiptEmail(receiptId: string): Promise<void> {
    const receipt = await prisma.receipt.findUnique({
      where: { id: receiptId },
      include: { tenantProfile: true, organization: true },
    });

    if (!receipt || !receipt.tenantProfile.email) return;

    const attachmentPath = path.join(process.cwd(), 'uploads', 'receipts', `${receipt.receiptNumber}.pdf`);

    await emailQueue.add('send-email', {
      to: receipt.tenantProfile.email,
      subject: `Quittance de Loyer N° ${receipt.receiptNumber} - Naforo`,
      html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
        <h2 style="color: #10b981;">Quittance de Loyer - Naforo</h2>
        <p>Bonjour ${receipt.tenantProfile.firstName},</p>
        <p>Votre paiement a été validé. Veuillez trouver ci-joint votre quittance de loyer officielle pour la période de <strong>${getMonthName(receipt.periodMonth, receipt.periodYear)}</strong>.</p>
        <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; padding: 15px; border-radius: 6px; margin: 20px 0;">
          <table style="width: 100%; font-size: 14px;">
            <tr><td><strong>Reçu :</strong></td><td style="text-align: right;">${receipt.receiptNumber}</td></tr>
            <tr><td><strong>Montant payé :</strong></td><td style="text-align: right; font-weight: bold; color: #047857;">${formatCurrency(Number(receipt.amount))}</td></tr>
            <tr><td><strong>Période :</strong></td><td style="text-align: right;">${getMonthName(receipt.periodMonth, receipt.periodYear)}</td></tr>
          </table>
        </div>
        <p>Vous pouvez également télécharger toutes vos anciennes quittances à tout moment depuis votre historique personnel sur votre espace locataire.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 11px; color: #9ca3af; text-align: center;">Document certifié électroniquement et généré par Naforo pour ${receipt.organization.name}</p>
      </div>`,
      attachments: [
        {
          filename: `${receipt.receiptNumber}.pdf`,
          path: attachmentPath,
        }
      ]
    });
  }

  async verifyReceipt(receiptNumber: string, signature: string): Promise<any> {
    const receipt = await receiptsRepository.verify(receiptNumber, signature);
    if (!receipt) {
      throw new BadRequestError('Ce reçu de quittance de loyer est invalide ou a été altéré.');
    }
    return receipt;
  }
}

export const receiptsService = new ReceiptsService();
export default receiptsService;

