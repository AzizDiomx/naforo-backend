import fs from 'fs';
import path from 'path';
import os from 'os';
import PDFDocument from 'pdfkit';
import { prisma } from '@/config/database';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { receiptsService } from '@/modules/receipts/receipts.service';
import { invoicesService } from '@/modules/invoices/invoices.service';
import { generateContractPDF } from '@/modules/contracts/contract.pdf';
import { generateCrgPdf } from '@/modules/management-reports/crg.pdf';
import { generateSubscriptionInvoicePdf } from '@/modules/subscriptions/pdf.generator';
import { convertAmountXof } from '@/modules/accounting/accounting.repository';

let tableInitialized = false;

/**
 * Garantit l'existence de la table PostgreSQL `uploaded_files` pour persister
 * les fichiers téléversés (PDF, PNG, JPEG, WEBP) au-delà des redéploiements
 * et redémarrages de conteneurs / instances serverless.
 */
export async function ensureUploadedFilesTable(): Promise<void> {
  if (tableInitialized) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS uploaded_files (
        filename TEXT PRIMARY KEY,
        "mimeType" TEXT NOT NULL,
        "originalName" TEXT,
        "size" INTEGER,
        "data" BYTEA NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    tableInitialized = true;
  } catch (err) {
    logger.warn('Impossible d\'initialiser la table uploaded_files:', err);
  }
}

/**
 * Sauvegarde un fichier physique dans PostgreSQL (`uploaded_files`) pour résilience permanente.
 */
export async function saveFileToDatabase(
  filename: string,
  filePath: string,
  mimeType: string = 'application/octet-stream',
  originalName?: string,
  size?: number
): Promise<void> {
  try {
    if (!fs.existsSync(filePath)) return;
    await ensureUploadedFilesTable();
    const cleanName = path.basename(filename);
    const buffer = fs.readFileSync(filePath);
    const fileSize = size ?? buffer.length;

    await prisma.$executeRaw`
      INSERT INTO uploaded_files (filename, "mimeType", "originalName", "size", "data", "createdAt")
      VALUES (${cleanName}, ${mimeType}, ${originalName || cleanName}, ${fileSize}, ${buffer}, NOW())
      ON CONFLICT (filename) DO UPDATE
      SET "mimeType" = EXCLUDED."mimeType",
          "originalName" = EXCLUDED."originalName",
          "size" = EXCLUDED."size",
          "data" = EXCLUDED."data"
    `;
  } catch (err) {
    logger.warn(`Sauvegarde BDD du fichier ${filename} ignorée:`, err);
  }
}

/**
 * Récupère un fichier depuis PostgreSQL (`uploaded_files`) s'il a été effacé du disque éphémère.
 */
export async function getFileFromDatabase(
  filename: string
): Promise<{ data: Buffer; mimeType: string; originalName?: string } | null> {
  try {
    await ensureUploadedFilesTable();
    const cleanName = path.basename(filename);
    const rows = await prisma.$queryRaw<
      Array<{ filename: string; mimeType: string; originalName: string | null; data: Buffer }>
    >`
      SELECT filename, "mimeType", "originalName", "data"
      FROM uploaded_files
      WHERE filename = ${cleanName}
      LIMIT 1
    `;

    if (rows && rows.length > 0 && rows[0].data) {
      const row = rows[0];
      const buf = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data as any);
      return {
        data: buf,
        mimeType: row.mimeType || guessMimeType(cleanName),
        originalName: row.originalName || cleanName,
      };
    }
  } catch (err) {
    logger.warn(`Lecture BDD du fichier ${filename} échouée:`, err);
  }
  return null;
}

export function guessMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

/**
 * Génère un PDF d'attestation / justificatif pour un paiement locatif, un document GED,
 * une dépense comptable ou un incident lorsque le fichier original éphémère a été purgé
 * avant la mise en place de la persistance BDD.
 */
async function generateFallbackPdfBuffer(options: {
  title: string;
  subtitle: string;
  reference: string;
  organization?: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    city?: string | null;
    primaryColor?: string | null;
  } | null;
  rows: Array<{ label: string; value: string }>;
  footerNote?: string;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const primaryColor = options.organization?.primaryColor || '#013e37';
    const orgName = (options.organization?.name || 'NAFORO — GESTION LOCATIVE').toUpperCase();

    // Bandeau supérieur
    doc.rect(50, 45, 495, 65).fill(primaryColor);
    doc.fillColor('#facc15').fontSize(15).font('Helvetica-Bold').text(orgName, 65, 60);
    doc.fillColor('#ffffff').fontSize(9.5).font('Helvetica').text(options.subtitle, 65, 82);

    const contactRight = [options.organization?.phone, options.organization?.email].filter(Boolean).join(' • ');
    if (contactRight) {
      doc.fillColor('#e2e8f0').fontSize(8.5).text(contactRight, 320, 62, { width: 210, align: 'right' });
    }
    if (options.organization?.address || options.organization?.city) {
      doc.fillColor('#e2e8f0').fontSize(8.5).text(
        `${options.organization?.address || ''} ${options.organization?.city || ''}`.trim(),
        320,
        78,
        { width: 210, align: 'right' }
      );
    }

    // Titre du document
    let currentY = 135;
    doc.fillColor('#111827').fontSize(15).font('Helvetica-Bold').text(options.title, 50, currentY, { align: 'center' });
    currentY += 24;
    doc.fillColor(primaryColor).fontSize(9.5).font('Helvetica-Bold').text(`RÉFÉRENCE : ${options.reference}`, 50, currentY, { align: 'center' });
    currentY += 30;

    // Tableau des informations
    doc.rect(50, currentY, 495, 24).fill('#f1f5f9');
    doc.fillColor(primaryColor).fontSize(9.5).font('Helvetica-Bold').text('DÉTAILS DE LA PIÈCE JUSTIFICATIVE / ARCHIVE NUMÉRIQUE', 62, currentY + 7);
    currentY += 32;

    for (const row of options.rows) {
      doc.fillColor('#4b5563').fontSize(9.5).font('Helvetica-Bold').text(row.label, 62, currentY, { width: 170 });
      doc.fillColor('#111827').fontSize(9.5).font('Helvetica').text(row.value || '—', 240, currentY, { width: 295 });
      currentY += 22;
      doc.moveTo(50, currentY - 5).lineTo(545, currentY - 5).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
    }

    currentY += 20;
    doc.rect(50, currentY, 495, 65).fillAndStroke('#f8fafc', '#cbd5e1');
    doc.fillColor('#1e293b').fontSize(9).font('Helvetica-Bold').text('CERTIFICATION D\'INTÉGRITÉ NAFORO', 65, currentY + 12);
    doc.fillColor('#475569').fontSize(8.5).font('Helvetica').text(
      options.footerNote ||
        'Ce document justificatif est généré et certifié par la plateforme Naforo à partir des écritures enregistrées et validées en base de données.',
      65,
      currentY + 28,
      { width: 465 }
    );

    // Pied de page
    doc.fillColor('#9ca3af').fontSize(8).font('Helvetica').text(
      `Document généré le ${new Date().toLocaleDateString('fr-FR')} • Plateforme Naforo`,
      50,
      760,
      { align: 'center', width: 495 }
    );

    doc.end();
  });
}

/**
 * Recherche un fichier sur le disque, dans la table `uploaded_files`, ou régénère
 * dynamiquement le PDF correspondant à partir des entités métiers (Quittance, Facture,
 * Contrat, CRG, Abonnement, Preuve de paiement, Document GED, Incident, Comptabilité).
 */
export async function resolveOrRegenerateUpload(
  filename: string,
  subfolder?: string
): Promise<{ filePath?: string; buffer?: Buffer; mimeType: string; downloadName: string } | null> {
  const cleanFilename = path.basename(filename);
  const uploadDirName = env.UPLOAD_DIR || 'uploads';
  const staticUploadsDirLocal = path.join(process.cwd(), uploadDirName);
  const staticUploadsDirTmp = path.join(os.tmpdir(), uploadDirName);

  const subdirs = subfolder
    ? [subfolder]
    : ['', 'receipts', 'invoices', 'subscription-invoices', 'contracts', 'crg'];

  const candidates: string[] = [];
  for (const sub of subdirs) {
    if (sub) {
      candidates.push(path.join(staticUploadsDirTmp, sub, cleanFilename));
      candidates.push(path.join(staticUploadsDirLocal, sub, cleanFilename));
    } else {
      candidates.push(path.join(staticUploadsDirTmp, cleanFilename));
      candidates.push(path.join(staticUploadsDirLocal, cleanFilename));
    }
  }
  candidates.push(path.join(os.tmpdir(), cleanFilename));

  // 1. Vérifier sur le disque physique
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return {
        filePath: p,
        mimeType: guessMimeType(cleanFilename),
        downloadName: cleanFilename,
      };
    }
  }

  // 2. Vérifier dans PostgreSQL (`uploaded_files`)
  const dbFile = await getFileFromDatabase(cleanFilename);
  if (dbFile) {
    return {
      buffer: dbFile.data,
      mimeType: dbFile.mimeType,
      downloadName: cleanFilename,
    };
  }

  // 3. Si c'est un PDF, tenter la régénération à la volée depuis les tables métiers
  if (!cleanFilename.toLowerCase().endsWith('.pdf')) {
    return null;
  }

  const baseIdOrRef = cleanFilename.replace(/\.pdf$/i, '');
  const cleanContractRef = baseIdOrRef.replace(/^BAIL-/i, '');

  try {
    // 3a. Quittance de loyer (Receipt)
    const receipt = await prisma.receipt.findFirst({
      where: {
        OR: [
          { receiptNumber: baseIdOrRef },
          { pdfUrl: { endsWith: `/${cleanFilename}` } },
        ],
      },
    });
    if (receipt) {
      await receiptsService.generateReceiptPDF(receipt.id, false);
      const genName = `${receipt.receiptNumber}.pdf`;
      const genCandidates = [
        path.join(staticUploadsDirTmp, 'receipts', genName),
        path.join(staticUploadsDirLocal, 'receipts', genName),
        ...candidates,
      ];
      for (const p of genCandidates) {
        if (fs.existsSync(p)) {
          await saveFileToDatabase(cleanFilename, p, 'application/pdf', cleanFilename);
          return { filePath: p, mimeType: 'application/pdf', downloadName: cleanFilename };
        }
      }
    }

    // 3b. Facture locative (Invoice)
    const invoice = await prisma.invoice.findFirst({
      where: {
        OR: [
          { invoiceNumber: baseIdOrRef },
          { pdfUrl: { endsWith: `/${cleanFilename}` } },
        ],
      },
    });
    if (invoice) {
      await invoicesService.generateInvoicePDF(invoice.id);
      const genName = `${invoice.invoiceNumber}.pdf`;
      const genCandidates = [
        path.join(staticUploadsDirTmp, 'invoices', genName),
        path.join(staticUploadsDirLocal, 'invoices', genName),
        ...candidates,
      ];
      for (const p of genCandidates) {
        if (fs.existsSync(p)) {
          await saveFileToDatabase(cleanFilename, p, 'application/pdf', cleanFilename);
          return { filePath: p, mimeType: 'application/pdf', downloadName: cleanFilename };
        }
      }
    }

    // 3c. Contrat de bail (Contract)
    const contract = await prisma.contract.findFirst({
      where: {
        OR: [
          { contractNumber: cleanContractRef },
          { contractNumber: baseIdOrRef },
          { documentUrl: { endsWith: `/${cleanFilename}` } },
          { signedPdfUrl: { endsWith: `/${cleanFilename}` } },
        ],
      },
      include: {
        organization: true,
        tenantProfile: true,
        property: {
          include: {
            landlord: true,
            parent: true,
          },
        },
      },
    });
    if (contract) {
      const pdfResult = await generateContractPDF({
        contract,
        organization: contract.organization,
        property: contract.property,
        tenant: contract.tenantProfile,
        landlord: contract.property?.landlord,
      });
      if (fs.existsSync(pdfResult.absolutePath)) {
        await saveFileToDatabase(cleanFilename, pdfResult.absolutePath, 'application/pdf', cleanFilename);
        return { filePath: pdfResult.absolutePath, mimeType: 'application/pdf', downloadName: cleanFilename };
      }
    }

    // 3d. Compte-Rendu de Gestion (ManagementReport / CRG)
    const crg = await prisma.managementReport.findFirst({
      where: {
        OR: [
          { reportNumber: baseIdOrRef },
          { pdfUrl: { endsWith: `/${cleanFilename}` } },
        ],
      },
      include: {
        organization: true,
        landlord: true,
      },
    });
    if (crg) {
      const summary = (crg.itemsSummary as any) || { collectedRents: [], maintenanceDeductions: [] };
      await generateCrgPdf({
        reportNumber: crg.reportNumber,
        periodMonth: crg.periodMonth,
        periodYear: crg.periodYear,
        startDate: crg.startDate,
        endDate: crg.endDate,
        grossRentCollected: Number(crg.grossRentCollected),
        managementFeeRate: Number(crg.managementFeeRate),
        managementFees: Number(crg.managementFees),
        feeTaxRate: Number(crg.feeTaxRate),
        feeTaxAmount: Number(crg.feeTaxAmount),
        maintenanceExpenses: Number(crg.maintenanceExpenses),
        otherDeductions: Number(crg.otherDeductions),
        netPayableToLandlord: Number(crg.netPayableToLandlord),
        organization: {
          name: crg.organization.name,
          email: crg.organization.email,
          phone: crg.organization.phone,
          address: crg.organization.address,
          city: crg.organization.city,
        },
        landlord: {
          displayName:
            crg.landlord.type === 'company'
              ? crg.landlord.companyName || 'Société Bailleur'
              : `${crg.landlord.firstName || ''} ${crg.landlord.lastName || ''}`.trim() || 'Propriétaire Mandant',
          email: crg.landlord.email,
          phone: crg.landlord.phone,
          address: crg.landlord.address,
          bankName: crg.landlord.bankName,
          ibanOrRib: crg.landlord.ibanOrRib,
          mobileMoneyNumber: crg.landlord.mobileMoneyNumber,
        },
        itemsSummary: {
          collectedRents: Array.isArray(summary.collectedRents) ? summary.collectedRents : [],
          maintenanceDeductions: Array.isArray(summary.maintenanceDeductions) ? summary.maintenanceDeductions : [],
        },
      });
      const genName = `${crg.reportNumber}.pdf`;
      const genCandidates = [
        path.join(staticUploadsDirTmp, 'crg', genName),
        path.join(staticUploadsDirLocal, 'crg', genName),
        ...candidates,
      ];
      for (const p of genCandidates) {
        if (fs.existsSync(p)) {
          await saveFileToDatabase(cleanFilename, p, 'application/pdf', cleanFilename);
          return { filePath: p, mimeType: 'application/pdf', downloadName: cleanFilename };
        }
      }
    }

    // 3e. Facture ou Preuve d'Abonnement SaaS (SubscriptionPayment)
    const subPayment = await prisma.subscriptionPayment.findFirst({
      where: {
        OR: [
          { paymentReference: baseIdOrRef },
          { pdfUrl: { endsWith: `/${cleanFilename}` } },
          { proofUrl: { endsWith: `/${cleanFilename}` } },
        ],
      },
      include: {
        organization: true,
        subscription: { include: { plan: true } },
      },
    });
    if (subPayment) {
      const convertedAmounts = await convertAmountXof(Number(subPayment.amountXof));
      const docParams = {
        paymentReference: subPayment.paymentReference,
        amountXof: Number(subPayment.amountXof),
        paymentMethod: subPayment.paymentMethod,
        transactionNumber: subPayment.transactionNumber,
        paymentDate: subPayment.paymentDate,
        billingCycle: subPayment.billingCycle || 'monthly',
        organization: {
          name: subPayment.organization?.name || 'Organisation',
          email: subPayment.organization?.email || null,
          phone: subPayment.organization?.phone || null,
          address: subPayment.organization?.address || null,
          city: subPayment.organization?.city || null,
        },
        subscription: {
          startDate: subPayment.subscription?.startDate || subPayment.paymentDate,
          endDate: subPayment.subscription?.endDate || subPayment.paymentDate,
          plan: {
            name: subPayment.subscription?.plan?.name || 'Plan Naforo',
            code: subPayment.subscription?.plan?.code,
            description: subPayment.subscription?.plan?.description,
            maxProperties: subPayment.subscription?.plan?.maxProperties,
            maxLots: subPayment.subscription?.plan?.maxLots,
            maxTenants: subPayment.subscription?.plan?.maxTenants,
            features: subPayment.subscription?.plan?.features,
          },
        },
      };
      await generateSubscriptionInvoicePdf(docParams as any, convertedAmounts);
      const genName = `FACTURE-${subPayment.paymentReference}.pdf`;
      const genCandidates = [
        path.join(staticUploadsDirTmp, 'subscription-invoices', genName),
        path.join(staticUploadsDirLocal, 'subscription-invoices', genName),
        ...candidates,
      ];
      for (const p of genCandidates) {
        if (fs.existsSync(p)) {
          await saveFileToDatabase(cleanFilename, p, 'application/pdf', cleanFilename);
          return { filePath: p, mimeType: 'application/pdf', downloadName: cleanFilename };
        }
      }
    }

    // 3f. Preuve de paiement locatif (Payment.proofUrl)
    const rentPayment = await prisma.payment.findFirst({
      where: {
        OR: [
          { proofUrl: { endsWith: `/${cleanFilename}` } },
        ],
      },
      include: {
        organization: true,
        tenantProfile: true,
        contract: { include: { property: true } },
        invoice: true,
        receipts: { take: 1 },
      },
    });
    if (rentPayment) {
      // S'il a déjà une quittance et que l'utilisateur cherche le PDF, on génère un justificatif complet de paiement
      const statusLabels: Record<string, string> = {
        validated: 'Validé & Encaissé',
        pending: 'En attente de validation',
        rejected: 'Rejeté',
        complement_requested: 'Complément requis',
      };
      const pdfBuffer = await generateFallbackPdfBuffer({
        title: 'JUSTIFICATIF DE PAIEMENT LOCATIF',
        subtitle: 'Attestation et trace numérique de déclaration de règlement',
        reference: rentPayment.paymentReference,
        organization: rentPayment.organization,
        rows: [
          { label: 'Référence Paiement', value: rentPayment.paymentReference },
          {
            label: 'Locataire',
            value: rentPayment.tenantProfile
              ? `${rentPayment.tenantProfile.firstName} ${rentPayment.tenantProfile.lastName} (${rentPayment.tenantProfile.phone})`
              : '—',
          },
          {
            label: 'Bien Immobilier / Bail',
            value: `${rentPayment.contract?.property?.name || 'Bien'} — Contrat ${rentPayment.contract?.contractNumber || ''}`,
          },
          {
            label: 'Montant déclaré',
            value: `${Number(rentPayment.amount).toLocaleString('fr-FR')} FCFA`,
          },
          { label: 'Moyen de paiement', value: rentPayment.paymentMethod.toUpperCase() },
          { label: 'N° de transaction', value: rentPayment.transactionNumber || 'Non spécifié' },
          {
            label: 'Date du paiement',
            value: new Date(rentPayment.paymentDate).toLocaleDateString('fr-FR'),
          },
          { label: 'Statut de validation', value: statusLabels[rentPayment.status] || rentPayment.status },
          ...(rentPayment.receipts?.[0]
            ? [{ label: 'Quittance associée', value: rentPayment.receipts[0].receiptNumber }]
            : []),
          ...(rentPayment.comment ? [{ label: 'Commentaire', value: rentPayment.comment }] : []),
        ],
      });
      return { buffer: pdfBuffer, mimeType: 'application/pdf', downloadName: cleanFilename };
    }

    // 3g. Document GED (Document.fileUrl)
    const gedDoc = await prisma.document.findFirst({
      where: {
        OR: [
          { fileUrl: { endsWith: `/${cleanFilename}` } },
        ],
      },
      include: {
        organization: true,
        uploader: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    if (gedDoc) {
      // Si le document GED est lié à un contrat de bail, régénérer le contrat de bail officiel
      if (gedDoc.entityType === 'contract' && gedDoc.entityId) {
        const linkedContract = await prisma.contract.findFirst({
          where: { id: gedDoc.entityId },
          include: {
            organization: true,
            tenantProfile: true,
            property: { include: { landlord: true, parent: true } },
          },
        });
        if (linkedContract) {
          const pdfResult = await generateContractPDF({
            contract: linkedContract,
            organization: linkedContract.organization,
            property: linkedContract.property,
            tenant: linkedContract.tenantProfile,
            landlord: linkedContract.property?.landlord,
          });
          if (fs.existsSync(pdfResult.absolutePath)) {
            await saveFileToDatabase(cleanFilename, pdfResult.absolutePath, 'application/pdf', gedDoc.name);
            return { filePath: pdfResult.absolutePath, mimeType: 'application/pdf', downloadName: cleanFilename };
          }
        }
      }

      const entityTypeLabels: Record<string, string> = {
        property: 'Bien Immobilier / Lot',
        tenant: 'Dossier Locataire',
        contract: 'Contrat de Bail',
        owner: 'Propriétaire / Bailleur',
        organization: 'Agence / Organisation',
      };

      const pdfBuffer = await generateFallbackPdfBuffer({
        title: 'FICHE D\'ARCHIVE DOCUMENTAIRE (GED)',
        subtitle: 'Gestion Électronique des Documents — Certificat d\'enregistrement',
        reference: gedDoc.id.slice(0, 8).toUpperCase(),
        organization: gedDoc.organization,
        rows: [
          { label: 'Nom du document', value: gedDoc.name },
          { label: 'Catégorie / Dossier', value: entityTypeLabels[gedDoc.entityType] || gedDoc.entityType },
          { label: 'Identifiant Dossier', value: gedDoc.entityId },
          { label: 'Format du fichier', value: gedDoc.mimeType || 'application/pdf' },
          {
            label: 'Taille originale',
            value: gedDoc.fileSize ? `${(gedDoc.fileSize / 1024).toFixed(1)} Ko` : '—',
          },
          {
            label: 'Déposé par',
            value: gedDoc.uploader
              ? `${gedDoc.uploader.firstName} ${gedDoc.uploader.lastName} (${gedDoc.uploader.email})`
              : 'Administrateur',
          },
          {
            label: 'Date d\'archivage',
            value: new Date(gedDoc.createdAt).toLocaleDateString('fr-FR', {
              day: '2-digit',
              month: 'long',
              year: 'numeric',
            }),
          },
        ],
      });
      return { buffer: pdfBuffer, mimeType: 'application/pdf', downloadName: cleanFilename };
    }

    // 3h. Incident (Devis / Facture travaux) ou Écriture Comptable
    const incident = await prisma.incident.findFirst({
      where: {
        OR: [
          { quoteUrl: { endsWith: `/${cleanFilename}` } },
          { invoiceUrl: { endsWith: `/${cleanFilename}` } },
        ],
      },
      include: {
        organization: true,
        property: true,
        tenantProfile: true,
      },
    });
    if (incident) {
      const pdfBuffer = await generateFallbackPdfBuffer({
        title: 'JUSTIFICATIF TECHNIQUE & TRAVAUX',
        subtitle: 'Devis / Facture d\'intervention et maintenance immobilière',
        reference: incident.incidentNumber,
        organization: incident.organization,
        rows: [
          { label: 'N° Ticket Incident', value: incident.incidentNumber },
          { label: 'Objet de l\'intervention', value: incident.title },
          { label: 'Bien concerné', value: incident.property?.name || '—' },
          {
            label: 'Coût estimé / Devis',
            value: incident.estimatedCost ? `${Number(incident.estimatedCost).toLocaleString('fr-FR')} FCFA` : '—',
          },
          {
            label: 'Coût réel facturé',
            value: incident.actualCost ? `${Number(incident.actualCost).toLocaleString('fr-FR')} FCFA` : '—',
          },
          { label: 'Statut approbation', value: incident.expenseStatus || incident.status },
          { label: 'Description', value: incident.description || '—' },
        ],
      });
      return { buffer: pdfBuffer, mimeType: 'application/pdf', downloadName: cleanFilename };
    }

    const accountingTx = await prisma.accountingTransaction.findFirst({
      where: {
        OR: [
          { documentUrl: { endsWith: `/${cleanFilename}` } },
        ],
      },
      include: {
        organization: true,
        property: true,
      },
    });
    if (accountingTx) {
      const pdfBuffer = await generateFallbackPdfBuffer({
        title: 'PIÈCE JUSTIFICATIVE COMPTABLE',
        subtitle: 'Écriture du Grand Livre Immobilier',
        reference: accountingTx.referenceNumber || accountingTx.id.slice(0, 8).toUpperCase(),
        organization: accountingTx.organization,
        rows: [
          { label: 'Libellé de l\'écriture', value: accountingTx.label },
          { label: 'Type d\'opération', value: accountingTx.type === 'REVENUE' ? 'Recette / Revenu' : 'Dépense / Charge' },
          { label: 'Catégorie', value: accountingTx.category },
          { label: 'Montant', value: `${Number(accountingTx.amountXof).toLocaleString('fr-FR')} FCFA` },
          { label: 'Bien rattaché', value: accountingTx.property?.name || 'Général Agence' },
          { label: 'Date de l\'opération', value: new Date(accountingTx.transactionDate).toLocaleDateString('fr-FR') },
          ...(accountingTx.notes ? [{ label: 'Notes', value: accountingTx.notes }] : []),
        ],
      });
      return { buffer: pdfBuffer, mimeType: 'application/pdf', downloadName: cleanFilename };
    }

    // 3i. Si c'est un UUID .pdf qui ne figure plus dans aucune table (ex: ancien fichier éphémère d'une instance redéployée)
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i.test(cleanFilename)) {
      const pdfBuffer = await generateFallbackPdfBuffer({
        title: 'DOCUMENT ARCHIVÉ NAFORO',
        subtitle: 'Certificat de référence documentaire',
        reference: baseIdOrRef.toUpperCase(),
        organization: null,
        rows: [
          { label: 'Identifiant du fichier', value: cleanFilename },
          { label: 'Statut du stockage', value: 'Archive issue d\'une session précédente' },
          { label: 'Date de consultation', value: new Date().toLocaleDateString('fr-FR') },
        ],
        footerNote:
          'Ce fichier a été téléversé avant l\'activation de la persistance binaire en base de données lors d\'un précédent déploiement serveur. Vous pouvez téléverser une nouvelle version depuis votre espace de gestion pour la conserver de manière permanente.',
      });
      return { buffer: pdfBuffer, mimeType: 'application/pdf', downloadName: cleanFilename };
    }
  } catch (err) {
    logger.error(`Erreur lors de la résolution/régénération du fichier (${cleanFilename}):`, err);
  }

  return null;
}
