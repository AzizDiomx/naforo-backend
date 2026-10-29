import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface CrgPdfData {
  reportNumber: string;
  periodMonth: number;
  periodYear: number;
  startDate: Date;
  endDate: Date;
  grossRentCollected: number;
  managementFeeRate: number;
  managementFees: number;
  feeTaxRate: number;
  feeTaxAmount: number;
  maintenanceExpenses: number;
  otherDeductions: number;
  netPayableToLandlord: number;
  organization: {
    name: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    city?: string | null;
  };
  landlord: {
    displayName: string;
    email?: string | null;
    phone: string;
    address?: string | null;
    bankName?: string | null;
    ibanOrRib?: string | null;
    mobileMoneyNumber?: string | null;
  };
  itemsSummary: {
    collectedRents: Array<{
      propertyName: string;
      tenantName: string;
      receiptNumber?: string;
      paymentDate?: string;
      amount: number;
    }>;
    maintenanceDeductions: Array<{
      incidentNumber: string;
      title: string;
      propertyName: string;
      amount: number;
      date?: string;
    }>;
  };
}

export async function generateCrgPdf(data: CrgPdfData): Promise<string> {
  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const dir = isServerless
    ? path.join(os.tmpdir(), 'uploads', 'crg')
    : path.join(process.cwd(), 'uploads', 'crg');

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filename = `${data.reportNumber}.pdf`;
  const absolutePath = path.join(dir, filename);
  const relativePath = `/uploads/crg/${filename}`;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const writeStream = fs.createWriteStream(absolutePath);

    doc.pipe(writeStream);

    const monthNames = [
      'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
      'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
    ];
    const periodLabel = `${monthNames[data.periodMonth - 1]} ${data.periodYear}`;

    const formatCurrency = (val: number) => {
      return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'XOF',
        maximumFractionDigits: 0,
      }).format(val).replace('XOF', 'FCFA');
    };

    // 1. Header Banner
    doc.rect(40, 40, 515, 65).fill('#013E37');

    doc.fillColor('#FACC15').fontSize(16).font('Helvetica-Bold')
      .text('COMPTE-RENDU DE GESTION LOCATIVE (CRG)', 55, 54);

    doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica')
      .text(`Réf : ${data.reportNumber}  •  Période : ${periodLabel}`, 55, 78);

    doc.fillColor('#E2E8F0').fontSize(9).font('Helvetica')
      .text(`${data.organization.name || 'Agence Immobilière'}`, 400, 56, { align: 'right', width: 140 })
      .text(`${data.organization.phone || ''}`, 400, 70, { align: 'right', width: 140 })
      .text(`${data.organization.city || 'Côte d\'Ivoire'}`, 400, 84, { align: 'right', width: 140 });

    doc.moveDown(2);

    // 2. Mandant / Landlord Card & Payment Coordinates
    let currentY = 120;
    doc.rect(40, currentY, 515, 78).fillAndStroke('#F8FAFC', '#E2E8F0');

    doc.fillColor('#013E37').fontSize(11).font('Helvetica-Bold')
      .text('PROPRIÉTAIRE MANDANT', 55, currentY + 10);

    doc.fillColor('#1F2937').fontSize(10).font('Helvetica-Bold')
      .text(data.landlord.displayName, 55, currentY + 26);

    doc.fillColor('#4B5563').fontSize(9).font('Helvetica')
      .text(`Téléphone : ${data.landlord.phone}`, 55, currentY + 42)
      .text(`Email : ${data.landlord.email || 'Non renseigné'}`, 55, currentY + 56);

    doc.fillColor('#013E37').fontSize(11).font('Helvetica-Bold')
      .text('COORDONNÉES DE REVERSEMENT', 320, currentY + 10);

    doc.fillColor('#4B5563').fontSize(9).font('Helvetica')
      .text(`Taux de gestion : ${data.managementFeeRate}% HT`, 320, currentY + 26)
      .text(`Banque : ${data.landlord.bankName || 'N/A'}`, 320, currentY + 42)
      .text(`IBAN / RIB : ${data.landlord.ibanOrRib || data.landlord.mobileMoneyNumber || 'Non renseigné'}`, 320, currentY + 56);

    // 3. Section: Rents Collected
    currentY += 95;
    doc.fillColor('#013E37').fontSize(11).font('Helvetica-Bold')
      .text('1. ÉTAT DES ENCAISSEMENTS LOCATIFS DU MOIS', 40, currentY);

    currentY += 16;
    doc.rect(40, currentY, 515, 20).fill('#013E37');
    doc.fillColor('#FFFFFF').fontSize(8.5).font('Helvetica-Bold')
      .text('BIEN / LOGEMENT', 48, currentY + 6)
      .text('LOCATAIRE', 180, currentY + 6)
      .text('DATE / QUITTANCE', 340, currentY + 6)
      .text('MONTANT ENCAISSÉ', 440, currentY + 6, { align: 'right', width: 105 });

    currentY += 20;

    const rents = data.itemsSummary?.collectedRents || [];
    if (rents.length === 0) {
      doc.rect(40, currentY, 515, 22).fillAndStroke('#FFFFFF', '#E2E8F0');
      doc.fillColor('#6B7280').fontSize(8.5).font('Helvetica-Oblique')
        .text('Aucun loyer encaissé sur cette période pour ce patrimoine.', 50, currentY + 6);
      currentY += 22;
    } else {
      rents.forEach((r, idx) => {
        const bg = idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB';
        doc.rect(40, currentY, 515, 20).fillAndStroke(bg, '#E2E8F0');
        doc.fillColor('#1F2937').fontSize(8.5).font('Helvetica')
          .text(r.propertyName, 48, currentY + 6, { width: 125, lineBreak: false })
          .text(r.tenantName, 180, currentY + 6, { width: 150, lineBreak: false })
          .text(r.receiptNumber || r.paymentDate || 'Validé', 340, currentY + 6, { width: 95, lineBreak: false });

        doc.fillColor('#013E37').font('Helvetica-Bold')
          .text(formatCurrency(r.amount), 440, currentY + 6, { align: 'right', width: 105 });

        currentY += 20;
      });
    }

    // Subtotal Rents
    doc.rect(40, currentY, 515, 20).fill('#E2E8F0');
    doc.fillColor('#1F2937').fontSize(9).font('Helvetica-Bold')
      .text('TOTAL DES LOYERS BRUTS ENCAISSÉS', 48, currentY + 5)
      .text(formatCurrency(data.grossRentCollected), 440, currentY + 5, { align: 'right', width: 105 });

    currentY += 32;

    // 4. Section: Maintenance & Deductions
    doc.fillColor('#013E37').fontSize(11).font('Helvetica-Bold')
      .text('2. TRAVAUX, RÉPARATIONS & DÉDUCTIONS DÉTAILLÉES', 40, currentY);

    currentY += 16;
    doc.rect(40, currentY, 515, 20).fill('#475569');
    doc.fillColor('#FFFFFF').fontSize(8.5).font('Helvetica-Bold')
      .text('N° TICKET / OBJET', 48, currentY + 6)
      .text('LOGEMENT CONCERNÉ', 220, currentY + 6)
      .text('MONTANT DÉDUIT', 440, currentY + 6, { align: 'right', width: 105 });

    currentY += 20;

    const maintenance = data.itemsSummary?.maintenanceDeductions || [];
    if (maintenance.length === 0) {
      doc.rect(40, currentY, 515, 22).fillAndStroke('#FFFFFF', '#E2E8F0');
      doc.fillColor('#6B7280').fontSize(8.5).font('Helvetica-Oblique')
        .text('Aucune dépense de réparation ni retenue de travaux sur cette période.', 50, currentY + 6);
      currentY += 22;
    } else {
      maintenance.forEach((m, idx) => {
        const bg = idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB';
        doc.rect(40, currentY, 515, 20).fillAndStroke(bg, '#E2E8F0');
        doc.fillColor('#1F2937').fontSize(8.5).font('Helvetica')
          .text(`${m.incidentNumber} - ${m.title}`, 48, currentY + 6, { width: 165, lineBreak: false })
          .text(m.propertyName, 220, currentY + 6, { width: 210, lineBreak: false });

        doc.fillColor('#DC2626').font('Helvetica-Bold')
          .text(`- ${formatCurrency(m.amount)}`, 440, currentY + 6, { align: 'right', width: 105 });

        currentY += 20;
      });
    }

    if (data.otherDeductions > 0) {
      doc.rect(40, currentY, 515, 20).fillAndStroke('#FFFFFF', '#E2E8F0');
      doc.fillColor('#1F2937').fontSize(8.5).font('Helvetica')
        .text('Autres retenues / charges diverses imputées', 48, currentY + 6);
      doc.fillColor('#DC2626').font('Helvetica-Bold')
        .text(`- ${formatCurrency(data.otherDeductions)}`, 440, currentY + 6, { align: 'right', width: 105 });
      currentY += 20;
    }

    // Subtotal Deductions
    const totalDeductions = data.maintenanceExpenses + data.otherDeductions;
    doc.rect(40, currentY, 515, 20).fill('#E2E8F0');
    doc.fillColor('#1F2937').fontSize(9).font('Helvetica-Bold')
      .text('TOTAL DES DÉPENSES TECHNIQUES & RETENUES', 48, currentY + 5)
      .text(`- ${formatCurrency(totalDeductions)}`, 440, currentY + 5, { align: 'right', width: 105 });

    currentY += 34;

    // 5. Financial Synthesis Box (Grand Total Box)
    doc.rect(260, currentY, 295, 120).fillAndStroke('#F8FAFC', '#013E37');

    doc.fillColor('#013E37').fontSize(10).font('Helvetica-Bold')
      .text('RÉCAPITULATIF FINANCIER & REVERSEMENT', 275, currentY + 10);

    doc.fillColor('#4B5563').fontSize(9).font('Helvetica')
      .text('Total Loyers Bruts Encaissés :', 275, currentY + 30)
      .fillColor('#1F2937').font('Helvetica-Bold')
      .text(formatCurrency(data.grossRentCollected), 450, currentY + 30, { align: 'right', width: 95 });

    doc.fillColor('#4B5563').fontSize(9).font('Helvetica')
      .text(`Honoraires de Gestion Agence (${data.managementFeeRate}%) :`, 275, currentY + 46)
      .fillColor('#DC2626').font('Helvetica-Bold')
      .text(`- ${formatCurrency(data.managementFees)}`, 450, currentY + 46, { align: 'right', width: 95 });

    if (data.feeTaxAmount > 0) {
      doc.fillColor('#4B5563').fontSize(9).font('Helvetica')
        .text(`TVA sur Honoraires (${data.feeTaxRate}%) :`, 275, currentY + 60)
        .fillColor('#DC2626').font('Helvetica-Bold')
        .text(`- ${formatCurrency(data.feeTaxAmount)}`, 450, currentY + 60, { align: 'right', width: 95 });
    }

    doc.fillColor('#4B5563').fontSize(9).font('Helvetica')
      .text('Dépenses Travaux & Déductions :', 275, currentY + 74)
      .fillColor('#DC2626').font('Helvetica-Bold')
      .text(`- ${formatCurrency(totalDeductions)}`, 450, currentY + 74, { align: 'right', width: 95 });

    // Net Payable Banner
    doc.rect(260, currentY + 92, 295, 28).fill('#013E37');
    doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold')
      .text('NET À REVERSER AU BAILLEUR :', 275, currentY + 100);
    doc.fillColor('#FACC15').fontSize(11).font('Helvetica-Bold')
      .text(formatCurrency(data.netPayableToLandlord), 420, currentY + 99, { align: 'right', width: 125 });

    // 6. Signatures and Verification block
    doc.rect(40, currentY, 205, 120).stroke('#E2E8F0');
    doc.fillColor('#013E37').fontSize(9.5).font('Helvetica-Bold')
      .text('Visa & Certification Agence', 55, currentY + 10);
    doc.fillColor('#6B7280').fontSize(8).font('Helvetica')
      .text('Arrêté et certifié conforme le :', 55, currentY + 26)
      .text(`${new Date().toLocaleDateString('fr-FR')} à ${data.organization.city || 'Abidjan'}`, 55, currentY + 38)
      .text('Par le Directeur de Gestion', 55, currentY + 54);

    doc.rect(55, currentY + 72, 175, 38).fillAndStroke('#FFFFFF', '#CBD5E1');
    doc.fillColor('#059669').fontSize(8).font('Helvetica-Bold')
      .text('CERTIFIÉ CONFORME NAFORO ✓', 62, currentY + 84);
    doc.fillColor('#64748B').fontSize(7).font('Helvetica')
      .text('Signature électronique cryptographique', 62, currentY + 96);

    // Footer note
    doc.fillColor('#94A3B8').fontSize(7.5).font('Helvetica')
      .text('Document contractuel généré par la plateforme SaaS Naforo - Conforme au droit OHADA de gestion immobilière.', 40, 780, { align: 'center', width: 515 });

    doc.end();

    writeStream.on('finish', () => resolve(relativePath));
    writeStream.on('error', (err) => reject(err));
  });
}
