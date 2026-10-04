import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { formatCurrency, formatDate } from '@/shared/helpers/date';

export interface SubscriptionInvoicePdfParams {
  paymentReference: string;
  amountXof: number;
  paymentMethod: string;
  transactionNumber: string | null;
  paymentDate: Date;
  billingCycle?: string | null;
  organization: {
    name: string;
    email: string | null;
    phone?: string | null;
    address?: string | null;
    city?: string | null;
  };
  subscription: {
    startDate: Date;
    endDate: Date;
    plan: {
      name: string;
      code?: string;
      description?: string | null;
      maxProperties?: number | null;
      maxTenants?: number | null;
      features?: any;
    };
  };
}

export interface ConvertedAmounts {
  EUR: number;
  USD: number;
  CAD: number;
}

export async function generateSubscriptionInvoicePdf(
  payment: SubscriptionInvoicePdfParams,
  convertedAmounts: ConvertedAmounts
): Promise<string> {
  const dir = path.join(process.cwd(), 'uploads', 'subscription-invoices');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filename = `${payment.paymentReference}.pdf`;
  const relativePath = `uploads/subscription-invoices/${filename}`;
  const absolutePath = path.join(process.cwd(), relativePath);

  // A4 dimensions: 595.28 x 841.89 points
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const writeStream = fs.createWriteStream(absolutePath);
  doc.pipe(writeStream);

  const primaryColor = '#013E37'; // Deep Emerald Naforo
  const accentEmerald = '#059669'; // Active Emerald
  const accentGold = '#D97706'; // Gold accent
  const textDark = '#0F172A'; // Slate 900
  const textMuted = '#64748B'; // Slate 500
  const borderLight = '#E2E8F0'; // Slate 200
  const bgLight = '#F8FAFC'; // Slate 50
  const bgEmeraldLight = '#F0FDF4'; // Emerald 50

  // ---------------------------------------------------------------------------
  // 1. TOP ACCENT BAR (Dual-tone brand header)
  // ---------------------------------------------------------------------------
  doc.rect(0, 0, 440, 6).fill(primaryColor);
  doc.rect(440, 0, 155.28, 6).fill(accentGold);

  // ---------------------------------------------------------------------------
  // 2. HEADER BRANDING & INVOICE METADATA (y = 28 to 110)
  // ---------------------------------------------------------------------------
  const logoPath = path.join(process.cwd(), 'assets', 'logo.png');
  let hasRenderedLogo = false;

  if (fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, 40, 24, { fit: [130, 42] });
      hasRenderedLogo = true;
    } catch {
      hasRenderedLogo = false;
    }
  }

  if (!hasRenderedLogo) {
    doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(22);
    doc.text('NAFORO', 40, 28);
  }

  // Tagline & Organization info
  const metaY = hasRenderedLogo ? 72 : 56;
  doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(8.5);
  doc.text('Plateforme Intelligente de Gestion Locative', 40, metaY);
  doc.fillColor(textMuted).font('Helvetica').fontSize(7.5);
  doc.text('Naforo Technologies CI SAS • Abidjan, Côte d\'Ivoire • www.naforo.ci', 40, metaY + 12);

  // Document Title & Metadata on the right
  const rightX = 330;
  const rightW = 225;
  doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(15);
  doc.text('FACTURE D\'ABONNEMENT', rightX, 26, { align: 'right', width: rightW });

  doc.fillColor(textDark).font('Helvetica-Bold').fontSize(9);
  doc.text(`Réf : ${payment.paymentReference}`, rightX, 47, { align: 'right', width: rightW });

  doc.fillColor(textMuted).font('Helvetica').fontSize(8);
  doc.text(`Date d'émission : ${formatDate(payment.paymentDate)}`, rightX, 60, { align: 'right', width: rightW });

  const isYearly = payment.billingCycle === 'yearly' || payment.amountXof > 100000;
  doc.text(`Période : ${isYearly ? 'Formule Annuelle (12 mois)' : 'Formule Mensuelle (30 jours)'}`, rightX, 72, { align: 'right', width: rightW });

  // Paid Status Badge
  doc.roundedRect(440, 88, 115, 20, 10).fillAndStroke(bgEmeraldLight, accentEmerald);
  doc.fillColor(accentEmerald).font('Helvetica-Bold').fontSize(7.5);
  doc.text('✓ RÈGLEMENT ACQUITTÉ', 440, 94, { align: 'center', width: 115 });

  // ---------------------------------------------------------------------------
  // 3. PARTIES / ADDRESSES SECTION (y = 122 to 208)
  // ---------------------------------------------------------------------------
  const cardY = 122;
  const cardH = 82;
  const cardW = 250;

  // Provider Box (Left)
  doc.roundedRect(40, cardY, cardW, cardH, 6).fillAndStroke(bgLight, borderLight);
  doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(7.5).text('ÉMETTEUR DU SERVICE', 52, cardY + 10);
  doc.fillColor(textDark).font('Helvetica-Bold').fontSize(10).text('Naforo Technologies CI SAS', 52, cardY + 22);
  doc.fillColor(textMuted).font('Helvetica').fontSize(7.5);
  doc.text('Siège Social : Cocody Palmeraie, Abidjan', 52, cardY + 36);
  doc.text('RCCM : CI-ABJ-2026-B-10928 • NCF : 2601928A', 52, cardY + 48);
  doc.text('Support & Facturation : support@naforo.ci', 52, cardY + 60);

  // Client Box (Right)
  doc.roundedRect(305, cardY, cardW, cardH, 6).fillAndStroke(bgLight, borderLight);
  doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(7.5).text('ORGANISATION CLIENTE', 317, cardY + 10);
  doc.fillColor(textDark).font('Helvetica-Bold').fontSize(10).text(payment.organization.name, 317, cardY + 22, { width: 226, lineBreak: false, ellipsis: true });
  doc.fillColor(textMuted).font('Helvetica').fontSize(7.5);
  doc.text(`Email : ${payment.organization.email || 'Non spécifié'}`, 317, cardY + 36, { width: 226, lineBreak: false, ellipsis: true });
  doc.text(`Téléphone : ${payment.organization.phone || 'Non spécifié'}`, 317, cardY + 48, { width: 226, lineBreak: false, ellipsis: true });
  doc.text(`Adresse : ${payment.organization.address || payment.organization.city || 'Abidjan, Côte d\'Ivoire'}`, 317, cardY + 60, { width: 226, lineBreak: false, ellipsis: true });

  // ---------------------------------------------------------------------------
  // 4. SUBSCRIPTION SERVICE TABLE (y = 218 to 365)
  // ---------------------------------------------------------------------------
  const tableY = 218;
  const tableW = 515;

  // Table Header Bar (Deep Emerald)
  doc.roundedRect(40, tableY, tableW, 24, 4).fill(primaryColor);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);
  doc.text('DÉSIGNATION & MODULES DU FORFAIT', 52, tableY + 8);
  doc.text('PÉRIODE D\'ACCÈS', 250, tableY + 8);
  doc.text('CYCLE', 370, tableY + 8);
  doc.text('TOTAL NET (XOF)', 450, tableY + 8, { align: 'right', width: 95 });

  // Table Body Container
  const rowY = tableY + 28;
  const rowH = 108;
  doc.roundedRect(40, rowY, tableW, rowH, 4).fillAndStroke('#FFFFFF', borderLight);

  // Plan Details (Col 1)
  doc.fillColor(textDark).font('Helvetica-Bold').fontSize(11);
  doc.text(`Forfait Naforo ${payment.subscription.plan.name}`, 52, rowY + 10);

  // Quotas text
  const maxProps = payment.subscription.plan.maxProperties;
  const maxTenants = payment.subscription.plan.maxTenants;
  const quotaText = maxProps && maxProps > 500
    ? 'Biens & locataires illimités'
    : `Jusqu'à ${maxProps || 15} biens et ${maxTenants || 15} locataires gérés`;

  doc.fillColor(accentEmerald).font('Helvetica-Bold').fontSize(8);
  doc.text(`✓ Quotas : ${quotaText}`, 52, rowY + 26);

  // Features description bullets
  doc.fillColor(textMuted).font('Helvetica').fontSize(7.5);
  doc.text('• Gestion des contrats, états des lieux & quittances numériques certifiées', 52, rowY + 40);
  doc.text('• Suivi automatisé des encaissements & relances multicanales', 52, rowY + 52);
  doc.text('• Accès multi-collaborateurs & tableau de bord financier temps réel', 52, rowY + 64);
  doc.text('• Sauvegardes cloud quotidiennes, assistance prioritaire & sécurité SSL', 52, rowY + 76);

  // Period (Col 2)
  doc.fillColor(textDark).font('Helvetica-Bold').fontSize(8.5);
  doc.text(`Du ${formatDate(payment.subscription.startDate)}`, 250, rowY + 12);
  doc.text(`Au ${formatDate(payment.subscription.endDate)}`, 250, rowY + 26);
  doc.fillColor(accentEmerald).font('Helvetica').fontSize(7.5);
  const diffDays = Math.round((new Date(payment.subscription.endDate).getTime() - new Date(payment.subscription.startDate).getTime()) / (1000 * 60 * 60 * 24));
  doc.text(`(${diffDays > 0 ? diffDays : 30} jours d'accès actif)`, 250, rowY + 40);

  // Billing Cycle (Col 3)
  doc.fillColor(textDark).font('Helvetica-Bold').fontSize(8.5);
  doc.text(isYearly ? 'Annuel' : 'Mensuel', 370, rowY + 12);
  if (isYearly) {
    doc.fillColor(accentGold).font('Helvetica').fontSize(7.5);
    doc.text('(-20% remise incluse)', 370, rowY + 26);
  }

  // Amount (Col 4)
  doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(12);
  doc.text(formatCurrency(payment.amountXof), 450, rowY + 12, { align: 'right', width: 95 });
  doc.fillColor(textMuted).font('Helvetica').fontSize(7.5);
  doc.text('Net à payer (TTC)', 450, rowY + 28, { align: 'right', width: 95 });
  doc.text('TVA 0% (Régime SaaS)', 450, rowY + 40, { align: 'right', width: 95 });

  // ---------------------------------------------------------------------------
  // 5. SETTLEMENT DETAILS & MULTI-CURRENCY BLOCK (y = 368 to 480)
  // ---------------------------------------------------------------------------
  const summaryY = 368;
  const summaryH = 100;
  const summaryW = 250;

  // Left Card: Règlement & Traçabilité
  doc.roundedRect(40, summaryY, summaryW, summaryH, 6).fillAndStroke(bgLight, borderLight);
  doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(8).text('MODALITÉS DE RÈGLEMENT', 52, summaryY + 10);

  doc.fillColor(textMuted).font('Helvetica').fontSize(8);
  doc.text('Mode de paiement :', 52, summaryY + 26);
  doc.fillColor(textDark).font('Helvetica-Bold').fontSize(8);
  const methodLabel = payment.paymentMethod.replace(/_/g, ' ').toUpperCase();
  doc.text(methodLabel, 135, summaryY + 26);

  doc.fillColor(textMuted).font('Helvetica').fontSize(8);
  doc.text('Réf. Transaction :', 52, summaryY + 40);
  doc.fillColor(textDark).font('Helvetica-Bold').fontSize(8);
  doc.text(payment.transactionNumber || 'Enregistré & validé', 135, summaryY + 40, { width: 145, lineBreak: false, ellipsis: true });

  doc.fillColor(textMuted).font('Helvetica').fontSize(8);
  doc.text('Date de validation :', 52, summaryY + 54);
  doc.fillColor(textDark).font('Helvetica').fontSize(8);
  doc.text(formatDate(payment.paymentDate), 135, summaryY + 54);

  doc.fillColor(textMuted).font('Helvetica').fontSize(8);
  doc.text('Statut règlement :', 52, summaryY + 68);
  doc.fillColor(accentEmerald).font('Helvetica-Bold').fontSize(8);
  doc.text('Encaissé & Validé ✓', 135, summaryY + 68);

  // Right Card: Total Net Acquitté & Conversions
  doc.roundedRect(305, summaryY, summaryW, summaryH, 6).fillAndStroke(bgEmeraldLight, accentEmerald);
  
  doc.fillColor('#065F46').font('Helvetica-Bold').fontSize(8.5).text('TOTAL NET ACQUITTÉ', 317, summaryY + 10);
  doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(14).text(formatCurrency(payment.amountXof), 420, summaryY + 8, { align: 'right', width: 125 });

  // Clean separator
  doc.strokeColor('#A7F3D0').lineWidth(0.5).moveTo(317, summaryY + 28).lineTo(543, summaryY + 28).stroke();

  doc.fillColor('#065F46').font('Helvetica-Bold').fontSize(7.5).text('Équivalences indicatives internationales :', 317, summaryY + 34);
  doc.fillColor('#047857').font('Helvetica').fontSize(8);
  doc.text(`• Euro (€) : ${convertedAmounts.EUR.toFixed(2)} €`, 317, summaryY + 48);
  doc.text(`• US Dollar ($) : ${convertedAmounts.USD.toFixed(2)} $`, 317, summaryY + 62);
  doc.text(`• Dollar Canadien (CAD) : ${convertedAmounts.CAD.toFixed(2)} C$`, 317, summaryY + 76);

  // ---------------------------------------------------------------------------
  // 6. CERTIFIED ELECTRONIC STAMP & SECURITY HASH (y = 482 to 552)
  // ---------------------------------------------------------------------------
  const stampY = 482;
  const stampH = 70;
  doc.roundedRect(40, stampY, tableW, stampH, 6).fillAndStroke(bgLight, '#CBD5E1');

  doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(8);
  doc.text('CERTIFICAT D\'ACQUITTEMENT & SCELLÉ NUMÉRIQUE NAFORO', 52, stampY + 10);

  doc.fillColor(textMuted).font('Helvetica').fontSize(7.5);
  doc.text(
    'Le présent document certifie la validité du paiement et l\'activation effective des accès logiciels au compte de l\'organisation. Ce reçu fait foi de justificatif comptable et fiscal conformément aux normes commerciales en vigueur.',
    52,
    stampY + 23,
    { width: 490 }
  );

  // Unique cryptographic hash for anti-tamper verification
  const hashSource = `${payment.paymentReference}-${payment.amountXof}-${payment.paymentDate.toISOString()}-${payment.organization.name}`;
  const securityHash = crypto.createHash('sha256').update(hashSource).digest('hex').substring(0, 32).toUpperCase();

  doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(7.5);
  doc.text(`EMPREINTE DE SÉCURITÉ : SHA-256 [${securityHash}]`, 52, stampY + 50);

  // ---------------------------------------------------------------------------
  // 7. FOOTER & LEGAL INFORMATION (y = 780 to 815)
  // ---------------------------------------------------------------------------
  const footerY = 780;
  doc.strokeColor(borderLight).lineWidth(0.8).moveTo(40, footerY).lineTo(555, footerY).stroke();

  doc.fillColor(textMuted).font('Helvetica').fontSize(7);
  doc.text(
    'Naforo Technologies CI SAS • Société par Actions Simplifiée • Capital social : 10.000.000 FCFA • NCF : 2601928A • RCCM : CI-ABJ-2026-B-10928',
    40,
    footerY + 8,
    { align: 'center', width: 515 }
  );
  doc.text(
    'Plateforme SaaS conforme droit OHADA • Pour toute question : facturation@naforo.ci • https://naforo.ci',
    40,
    footerY + 20,
    { align: 'center', width: 515 }
  );

  doc.end();

  // Wait for stream to finish writing
  await new Promise<boolean>((resolve, reject) => {
    writeStream.on('finish', () => resolve(true));
    writeStream.on('error', reject);
  });

  return relativePath;
}
