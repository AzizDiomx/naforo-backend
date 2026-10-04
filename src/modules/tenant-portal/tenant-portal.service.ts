import * as repo from './tenant-portal.repository';
import { prisma } from '@/config/database';
import { NotFoundError, BadRequestError } from '@/shared/errors/AppError';
import { dispatchNotification } from '@/shared/helpers/notification';

export async function getTenantOverview(userId: string) {
  const profile = await repo.findTenantProfileByUserId(userId);
  if (!profile) {
    throw new NotFoundError("Aucun profil locataire associé à ce compte.");
  }

  const activeContract = await repo.findActiveContractByTenantId(profile.id);
  let dueInvoice = null;

  if (activeContract) {
    dueInvoice = await repo.findPendingInvoiceByContractId(activeContract.id);
  }

  const recentPayments = await repo.findPaymentsByTenantId(profile.id);
  const incidents = await repo.findIncidentsByTenantId(profile.id);

  return {
    profile: {
      id: profile.id,
      firstName: profile.firstName,
      lastName: profile.lastName,
      phone: profile.phone,
      email: profile.email || profile.user?.email,
      reliabilityScore: profile.reliabilityScore || 100,
      avatarUrl: profile.avatarUrl,
    },
    activeContract: activeContract ? {
      id: activeContract.id,
      contractNumber: activeContract.contractNumber,
      propertyName: activeContract.property.name,
      propertyAddress: activeContract.property.address,
      rentAmount: Number(activeContract.rentAmount),
      chargesAmount: Number(activeContract.chargesAmount || 0),
      totalMonthlyAmount: Number(activeContract.rentAmount) + Number(activeContract.chargesAmount || 0),
      paymentDay: activeContract.paymentDay,
      startDate: activeContract.startDate,
      endDate: activeContract.endDate,
    } : null,
    dueInvoice: dueInvoice ? {
      id: dueInvoice.id,
      invoiceNumber: dueInvoice.invoiceNumber,
      periodMonth: dueInvoice.periodMonth,
      periodYear: dueInvoice.periodYear,
      totalAmount: dueInvoice.totalAmount,
      dueDate: dueInvoice.dueDate,
      status: dueInvoice.status,
    } : null,
    recentPayments: recentPayments.slice(0, 5),
    openIncidentsCount: incidents.filter((i: any) => i.status !== 'resolved').length,
  };
}

export async function getMyPayments(userId: string) {
  const profile = await repo.findTenantProfileByUserId(userId);
  if (!profile) throw new NotFoundError("Profil locataire non trouvé.");
  return await repo.findPaymentsByTenantId(profile.id);
}

export async function declarePayment(userId: string, body: any, file?: Express.Multer.File) {
  const profile = await repo.findTenantProfileByUserId(userId);
  if (!profile) throw new NotFoundError("Profil locataire non trouvé.");

  const activeContract = await repo.findActiveContractByTenantId(profile.id);
  if (!activeContract) throw new BadRequestError("Aucun contrat actif trouvé pour effectuer un paiement.");

  // 1. Anti-doublon check: Prevent duplicate PENDING declarations for the same contract/invoice
  const existingPendingPayment = await prisma.payment.findFirst({
    where: {
      contractId: activeContract.id,
      tenantProfileId: profile.id,
      status: { in: ['pending', 'complement_requested'] },
      ...(body.invoiceId ? { invoiceId: body.invoiceId } : {}),
    },
  });

  if (existingPendingPayment) {
    throw new BadRequestError("Une déclaration de paiement est déjà en cours de vérification par votre bailleur pour ce bail. Veuillez patienter jusqu'à son traitement.");
  }

  // 2. Invoice validation
  if (body.invoiceId) {
    const invoice = await prisma.invoice.findUnique({ where: { id: body.invoiceId } });
    if (invoice && invoice.status === 'paid') {
      throw new BadRequestError("Cette facture a déjà été intégralement réglée.");
    }
  }

  // 3. Unique transaction number check
  if (body.transactionNumber && body.transactionNumber.trim() && body.transactionNumber.trim() !== '-') {
    const existingTransaction = await prisma.payment.findFirst({
      where: {
        transactionNumber: body.transactionNumber.trim(),
        status: { in: ['pending', 'validated', 'complement_requested'] },
      },
    });

    if (existingTransaction) {
      throw new BadRequestError("Ce numéro de transaction Mobile Money ou bancaire a déjà été enregistré pour une autre déclaration.");
    }
  }

  const monthsCount = Math.max(1, Number(body.monthsCount || 1));
  const monthlyRent = Number(activeContract.rentAmount || 0) + Number(activeContract.chargesAmount || 0);
  const calculatedAmount = Number(body.amount || (monthlyRent * monthsCount));

  const commentWithAdvance = monthsCount > 1 
    ? `[Paiement de ${monthsCount} mois d'avance] ${body.comment || ''}`.trim()
    : body.comment;

  const proofUrl = file ? `/uploads/${file.filename}` : undefined;

  const payment = await repo.createTenantPayment({
    organizationId: profile.organizationId,
    contractId: activeContract.id,
    invoiceId: body.invoiceId,
    tenantProfileId: profile.id,
    declaredBy: userId,
    amount: calculatedAmount,
    paymentMethod: body.paymentMethod,
    transactionNumber: body.transactionNumber ? body.transactionNumber.trim() : `TX-${Date.now()}`,
    paymentDate: body.paymentDate || new Date().toISOString().split('T')[0],
    proofUrl,
    comment: commentWithAdvance,
  });

  // 1. Notify Landlord & Organization Admin in real-time
  const tenantName = `${profile.firstName} ${profile.lastName}`;
  const amountFormatted = Number(payment.amount).toLocaleString('fr-FR');

  try {
    await dispatchNotification({
      organizationId: profile.organizationId,
      type: 'PAYMENT_DECLARED',
      title: '💳 Nouveau paiement de loyer déclaré',
      emailSubject: `[Naforo] Nouveau règlement déclaré par ${tenantName}`,
      emailHtml: `
        <div style="font-family: Arial, sans-serif; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #2563eb;">Nouveau règlement locataire</h2>
          <p>Le locataire <strong>${tenantName}</strong> a déclaré un paiement de <strong>${amountFormatted} FCFA</strong> via <strong>${payment.paymentMethod}</strong>.</p>
          <p><strong>Référence transaction:</strong> ${payment.transactionNumber || 'Non renseignée'}</p>
          <p><strong>Logement:</strong> ${activeContract.property.name}</p>
          <p style="margin-top: 20px;">Connectez-vous à votre Backoffice Naforo pour consulter le justificatif et valider la quittance.</p>
        </div>
      `,
      smsText: `Naforo: Le locataire ${tenantName} a déclaré un paiement de ${amountFormatted} FCFA via ${payment.paymentMethod}. Connectez-vous au Backoffice pour valider la quittance.`,
      data: { paymentId: payment.id, tenantProfileId: profile.id, contractId: activeContract.id },
    });
  } catch (notifErr) {}

  // 2. Notify Tenant (Confirmation)
  try {
    await dispatchNotification({
      userId: userId,
      type: 'PAYMENT_DECLARED_CONFIRMATION',
      title: '✅ Déclaration de paiement enregistrée',
      emailSubject: `[Naforo] Confirmation de votre déclaration de paiement`,
      emailHtml: `
        <div style="font-family: Arial, sans-serif; color: #0f172a; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #16a34a;">Règlement transmis avec succès</h2>
          <p>Votre déclaration de paiement de <strong>${amountFormatted} FCFA</strong> (${payment.paymentMethod}) a bien été enregistrée et transmise à votre propriétaire.</p>
          <p>Vous recevrez une alerte dès que votre quittance officielle sera émise.</p>
        </div>
      `,
      smsText: `Naforo: Votre déclaration de paiement de ${amountFormatted} FCFA a bien été enregistrée et transmise à votre propriétaire.`,
      data: { paymentId: payment.id },
    });
  } catch (notifErr) {}

  return payment;
}

export async function getMyReceipts(userId: string) {
  const profile = await repo.findTenantProfileByUserId(userId);
  if (!profile) throw new NotFoundError("Profil locataire non trouvé.");
  const receipts = await repo.findReceiptsByTenantId(profile.id);

  // Ensure PDF is generated on-the-fly if missing
  for (const r of receipts) {
    if (!r.pdfUrl) {
      try {
        const { receiptsService } = await import('@/modules/receipts/receipts.service');
        r.pdfUrl = await receiptsService.generateReceiptPDF(r.id);
      } catch (err) {}
    }
  }

  return receipts;
}

export async function getMyIncidents(userId: string) {
  const profile = await repo.findTenantProfileByUserId(userId);
  if (!profile) throw new NotFoundError("Profil locataire non trouvé.");
  return await repo.findIncidentsByTenantId(profile.id);
}

export async function reportIncident(userId: string, body: any, files?: Express.Multer.File[]) {
  const profile = await repo.findTenantProfileByUserId(userId);
  if (!profile) throw new NotFoundError("Profil locataire non trouvé.");

  const activeContract = await repo.findActiveContractByTenantId(profile.id);
  if (!activeContract) throw new BadRequestError("Aucun contrat actif pour déclarer un incident.");

  const photos = files ? files.map(f => `/uploads/${f.filename}`) : [];

  return await repo.createTenantIncident({
    organizationId: profile.organizationId,
    propertyId: activeContract.propertyId,
    tenantProfileId: profile.id,
    type: body.type,
    title: body.title,
    description: body.description,
    priority: body.priority || 'medium',
    photos,
  });
}

export async function getMyDocuments(userId: string) {
  const profile = await repo.findTenantProfileByUserId(userId);
  if (!profile) throw new NotFoundError("Profil locataire non trouvé.");

  const activeContract = await repo.findActiveContractByTenantId(profile.id);
  if (!activeContract) return [];

  return await repo.findDocumentsByEntityId(activeContract.id);
}

export async function uploadPaymentProof(userId: string, paymentId: string, file: Express.Multer.File) {
  const profile = await repo.findTenantProfileByUserId(userId);
  if (!profile) throw new NotFoundError("Profil locataire non trouvé.");

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId }
  });

  if (!payment || payment.tenantProfileId !== profile.id) {
    throw new NotFoundError("Paiement introuvable.");
  }

  if (payment.status === 'validated') {
    throw new BadRequestError("Ce paiement a déjà été validé par votre propriétaire. Le justificatif ne peut plus être modifié.");
  }

  if (payment.status === 'rejected') {
    throw new BadRequestError("Ce paiement a été rejeté. Veuillez effectuer une nouvelle déclaration de règlement avec un justificatif conforme.");
  }

  const proofUrl = `/uploads/${file.filename}`;
  await repo.updatePaymentProof(paymentId, profile.id, proofUrl);
  return { proofUrl };
}

export async function getMyNotifications(userId: string) {
  return await repo.findNotificationsByUserId(userId);
}

export async function markNotificationRead(userId: string, notificationId: string) {
  return await repo.markNotificationRead(notificationId, userId);
}

