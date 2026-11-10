import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { env } from '@/config/env';
import { formatDate } from '@/shared/helpers/date';

export interface GenerateEdlPdfOptions {
  inspection: any;
  organization: any;
  property: any;
  tenant?: any;
  inspector?: any;
}

const CONDITION_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  neuf: { bg: '#dcfce7', text: '#166534', label: 'NEUF' },
  bon: { bg: '#e0f2fe', text: '#075985', label: 'BON ÉTAT' },
  usage: { bg: '#fef3c7', text: '#92400e', label: "ÉTAT D'USAGE" },
  mauvais: { bg: '#fee2e2', text: '#991b1b', label: 'MAUVAIS ÉTAT' },
};

export async function generateEdlPdf(options: GenerateEdlPdfOptions): Promise<{ relativePath: string; absolutePath: string }> {
  const { inspection, organization, property, tenant, inspector } = options;

  const isEntry = inspection.type === 'entry';
  const typeLabel = isEntry ? "ÉTAT DES LIEUX D'ENTRÉE" : 'ÉTAT DES LIEUX DE SORTIE';
  const fileName = `${inspection.inspectionNumber}.pdf`;

  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const baseUploadsDir = isServerless
    ? path.join(os.tmpdir(), env.UPLOAD_DIR || 'uploads', 'edl')
    : path.join(process.cwd(), env.UPLOAD_DIR || 'uploads', 'edl');

  if (!fs.existsSync(baseUploadsDir)) {
    fs.mkdirSync(baseUploadsDir, { recursive: true });
  }

  const absolutePath = path.join(baseUploadsDir, fileName);
  const relativePath = `/uploads/edl/${fileName}`;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const writeStream = fs.createWriteStream(absolutePath);

    doc.pipe(writeStream);

    const primaryColor = organization?.primaryColor || '#013E37';
    const orgName = (organization?.name || 'NAFORO GESTION').toUpperCase();

    // 1. Bandeau supérieur officiel
    doc.rect(40, 35, 515, 60).fill(primaryColor);
    doc.fillColor('#FFEFB3').fontSize(14).font('Helvetica-Bold').text(orgName, 55, 48);
    doc.fillColor('#ffffff').fontSize(8.5).font('Helvetica').text('Administration Immobilière & Gestion Locative Certifiée', 55, 66);

    const contactLine = [organization?.phone, organization?.email].filter(Boolean).join(' • ');
    if (contactLine) {
      doc.fillColor('#e2e8f0').fontSize(8).text(contactLine, 300, 52, { width: 240, align: 'right' });
    }
    if (organization?.address || organization?.city) {
      doc.fillColor('#e2e8f0').fontSize(8).text(
        `${organization?.address || ''} ${organization?.city || ''}`.trim(),
        300,
        66,
        { width: 240, align: 'right' }
      );
    }

    // 2. Titre du document
    let y = 110;
    doc.fillColor('#0f172a').fontSize(15).font('Helvetica-Bold').text(typeLabel, 40, y, { align: 'center', width: 515 });
    y += 20;
    doc.fillColor(primaryColor).fontSize(10).font('Helvetica-Bold').text(`DOCUMENT N° ${inspection.inspectionNumber}`, 40, y, { align: 'center', width: 515 });
    y += 16;
    doc.fillColor('#64748b').fontSize(8.5).font('Helvetica').text(`Réalisé le ${formatDate(inspection.inspectionDate)}`, 40, y, { align: 'center', width: 515 });
    y += 22;

    // 3. Cadre des Parties prenantes (Bailleur / Locataire / Bien)
    doc.rect(40, y, 515, 80).fillAndStroke('#f8fafc', '#e2e8f0');

    // Colonne 1 : Le Bien
    doc.fillColor(primaryColor).fontSize(8.5).font('Helvetica-Bold').text('BIEN IMMOBILIER', 52, y + 10);
    doc.fillColor('#0f172a').fontSize(9).font('Helvetica-Bold').text(property?.name || 'Logement', 52, y + 24);
    doc.fillColor('#475569').fontSize(8).font('Helvetica').text(`Type : ${(property?.type || 'Appartement').toUpperCase()}`, 52, y + 38);
    doc.text(`Adresse : ${property?.address || ''}, ${property?.city || 'Abidjan'}`, 52, y + 50, { width: 155 });

    // Colonne 2 : Le Locataire
    doc.fillColor(primaryColor).fontSize(8.5).font('Helvetica-Bold').text('LOCATAIRE ENTRANT / SORTANT', 220, y + 10);
    if (tenant) {
      doc.fillColor('#0f172a').fontSize(9).font('Helvetica-Bold').text(`${tenant.firstName} ${tenant.lastName}`, 220, y + 24);
      doc.fillColor('#475569').fontSize(8).font('Helvetica').text(`Tél : ${tenant.phone || 'Non renseigné'}`, 220, y + 38);
      doc.text(`CNI / Pièce : ${tenant.nationalId || 'Conforme dossier'}`, 220, y + 50);
    } else {
      doc.fillColor('#64748b').fontSize(8.5).font('Helvetica').text('Attribué au bail en cours', 220, y + 24);
    }

    // Colonne 3 : L'Inspecteur / Mandataire
    doc.fillColor(primaryColor).fontSize(8.5).font('Helvetica-Bold').text('REPRÉSENTANT AGREE', 390, y + 10);
    const inspectorName = inspection.inspectorName || (inspector ? `${inspector.firstName} ${inspector.lastName}` : orgName);
    doc.fillColor('#0f172a').fontSize(9).font('Helvetica-Bold').text(inspectorName, 390, y + 24, { width: 155 });
    doc.fillColor('#475569').fontSize(8).font('Helvetica').text(`Bailleur / Agence : ${orgName}`, 390, y + 38, { width: 155 });

    y += 92;

    // 4. Relevé des Compteurs & Clés
    doc.rect(40, y, 515, 20).fill(primaryColor);
    doc.fillColor('#ffffff').fontSize(8.5).font('Helvetica-Bold').text('1. RELEVÉ DES COMPTEURS & INVENTAIRE DES CLÉS', 50, y + 5);
    y += 24;

    const meters = (inspection.meterReadings as any) || {};
    doc.rect(40, y, 515, 48).fillAndStroke('#ffffff', '#e2e8f0');

    // Électricité
    doc.fillColor('#0f172a').fontSize(8).font('Helvetica-Bold').text('ÉLECTRICITÉ (CIE)', 52, y + 8);
    doc.fillColor('#475569').fontSize(8).font('Helvetica').text(`N° Compteur : ${meters.electricityMeterNumber || '—'}`, 52, y + 20);
    doc.text(`Index : ${meters.electricityIndex ? `${meters.electricityIndex} kWh` : '—'}`, 52, y + 32);

    // Eau
    doc.fillColor('#0f172a').fontSize(8).font('Helvetica-Bold').text('EAU (SODECI)', 210, y + 8);
    doc.fillColor('#475569').fontSize(8).font('Helvetica').text(`N° Compteur : ${meters.waterMeterNumber || '—'}`, 210, y + 20);
    doc.text(`Index : ${meters.waterIndex ? `${meters.waterIndex} m³` : '—'}`, 210, y + 32);

    // Clés
    doc.fillColor('#0f172a').fontSize(8).font('Helvetica-Bold').text('INVENTAIRE DES CLÉS', 370, y + 8);
    doc.fillColor('#475569').fontSize(8).font('Helvetica').text(`Nombre : ${meters.keysCount || '—'} clé(s)`, 370, y + 20);
    doc.text(`Détails : ${meters.keysDetail || 'Porte d\'entrée, chambres'}`, 370, y + 32, { width: 175 });

    y += 58;

    // 5. Grille d'Inspection pièce par pièce
    doc.rect(40, y, 515, 20).fill(primaryColor);
    doc.fillColor('#ffffff').fontSize(8.5).font('Helvetica-Bold').text('2. DESCRIPTION ET ÉTAT DÉTAILLÉ DES PIÈCES', 50, y + 5);
    y += 24;

    const rooms = Array.isArray(inspection.roomsData) ? inspection.roomsData : [];

    for (const room of rooms) {
      // Vérifier le saut de page
      if (y > 690) {
        doc.addPage();
        y = 45;
      }

      // En-tête de la pièce
      doc.rect(40, y, 515, 18).fill('#f1f5f9');
      doc.fillColor(primaryColor).fontSize(8.5).font('Helvetica-Bold').text(room.roomName.toUpperCase(), 50, y + 4);

      const rCondition = CONDITION_COLORS[room.condition] || CONDITION_COLORS.bon;
      doc.rect(460, y + 2, 85, 14).fill(rCondition.bg);
      doc.fillColor(rCondition.text).fontSize(7).font('Helvetica-Bold').text(rCondition.label, 460, y + 5, { width: 85, align: 'center' });
      y += 20;

      // Éléments de la pièce
      const elements = Array.isArray(room.elements) ? room.elements : [];
      for (const el of elements) {
        if (y > 720) {
          doc.addPage();
          y = 45;
        }

        const elCondition = CONDITION_COLORS[el.condition] || CONDITION_COLORS.bon;
        doc.fillColor('#0f172a').fontSize(8).font('Helvetica-Bold').text(`• ${el.name}`, 52, y, { width: 150 });
        doc.rect(210, y - 2, 75, 13).fill(elCondition.bg);
        doc.fillColor(elCondition.text).fontSize(6.5).font('Helvetica-Bold').text(elCondition.label, 210, y + 1, { width: 75, align: 'center' });

        const comment = el.comment || 'Sans remarque particulière';
        doc.fillColor('#64748b').fontSize(7.5).font('Helvetica').text(comment, 295, y, { width: 250 });

        y += 16;
        doc.moveTo(40, y - 3).lineTo(555, y - 3).strokeColor('#f1f5f9').lineWidth(0.5).stroke();
      }
      y += 6;
    }

    // 6. Section Déductions Caution (si sortie) ou Observations
    if (y > 640) {
      doc.addPage();
      y = 45;
    }

    doc.rect(40, y, 515, 20).fill(primaryColor);
    doc.fillColor('#ffffff').fontSize(8.5).font('Helvetica-Bold').text('3. OBSERVATIONS GÉNÉRALES & CLAUSES FINALES', 50, y + 5);
    y += 24;

    doc.rect(40, y, 515, 45).fillAndStroke('#ffffff', '#e2e8f0');
    doc.fillColor('#334155').fontSize(8).font('Helvetica').text(
      inspection.generalObservations ||
        'Les parties déclarent avoir visité le logement dans son intégralité et reconnaissent la parfaite conformité des mentions consignées ci-dessus.',
      50,
      y + 8,
      { width: 495 }
    );

    if (!isEntry && Number(inspection.estimatedDeductionAmount) > 0) {
      y += 50;
      doc.rect(40, y, 515, 36).fillAndStroke('#fff1f2', '#fecdd3');
      doc.fillColor('#9f1239').fontSize(8.5).font('Helvetica-Bold').text(
        `ESTIMATION DES RETENUES SUR DÉPÔT DE GARANTIE : ${Number(inspection.estimatedDeductionAmount).toLocaleString('fr-FR')} FCFA`,
        50,
        y + 6
      );
      doc.fillColor('#be123c').fontSize(7.5).font('Helvetica').text(
        `Motifs : ${inspection.deductionDetails || 'Remise en état locative selon constat contradictoire ci-dessus.'}`,
        50,
        y + 18,
        { width: 495 }
      );
      y += 42;
    } else {
      y += 52;
    }

    // 7. Cadre de Signatures contradictoires
    if (y > 670) {
      doc.addPage();
      y = 45;
    }

    doc.rect(40, y, 250, 80).stroke('#cbd5e1');
    doc.fillColor(primaryColor).fontSize(8.5).font('Helvetica-Bold').text("POUR L'AGENCE / LE BAILLEUR", 50, y + 8);
    doc.fillColor('#64748b').fontSize(7.5).font('Helvetica').text('Signature et cachet du représentant', 50, y + 20);
    if (inspection.inspectorSignedAt) {
      doc.fillColor('#15803d').fontSize(7).font('Helvetica-Bold').text(`Signé électroniquement le ${formatDate(inspection.inspectorSignedAt)}`, 50, y + 60);
    }

    doc.rect(305, y, 250, 80).stroke('#cbd5e1');
    doc.fillColor(primaryColor).fontSize(8.5).font('Helvetica-Bold').text('POUR LE LOCATAIRE', 315, y + 8);
    doc.fillColor('#64748b').fontSize(7.5).font('Helvetica').text('Signature précédée de la mention "Lu et approuvé"', 315, y + 20);
    if (inspection.tenantSignedAt) {
      doc.fillColor('#15803d').fontSize(7).font('Helvetica-Bold').text(`Signé électroniquement le ${formatDate(inspection.tenantSignedAt)}`, 315, y + 60);
    }

    // Pied de page
    doc.fillColor('#94a3b8').fontSize(7).font('Helvetica').text(
      `Document contradictoire certifié édité par la plateforme Naforo • Page 1/1 • Réf: ${inspection.inspectionNumber}`,
      40,
      800,
      { align: 'center', width: 515 }
    );

    doc.end();

    writeStream.on('finish', () => resolve({ relativePath, absolutePath }));
    writeStream.on('error', reject);
  });
}
