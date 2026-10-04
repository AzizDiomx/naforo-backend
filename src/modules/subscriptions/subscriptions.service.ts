import { subscriptionsRepository } from './subscriptions.repository';
import { convertAmountXof } from '@/modules/accounting/accounting.repository';
import { generateSubscriptionInvoicePdf } from './pdf.generator';
import { prisma } from '@/config/database';
import { NotFoundError, BadRequestError, ForbiddenError } from '@/shared/errors/AppError';
import { logger } from '@/config/logger';
import { generateReference } from '@/shared/helpers/crypto';
import { emailQueue } from '@/queues';
import path from 'path';
import { sendMail, subscriptionPaymentApproved } from '@/config/mailer';
import { formatCurrency, formatDate } from '@/shared/helpers/date';
import { env } from '@/config/env';

export class SubscriptionsService {

  // --- PLANS ---
  async createPlan(data: {
    name: string;
    code: string;
    description?: string;
    priceMonthlyXof: number;
    yearlyDiscountPercent?: number;
    maxProperties: number;
    maxTenants: number;
    features: string[];
    isRecommended?: boolean;
  }) {
    const cleanCode = data.code.trim().toLowerCase();
    const existing = await subscriptionsRepository.findPlanByCode(cleanCode);
    if (existing) {
      throw new BadRequestError(`Un plan d'abonnement avec le code "${cleanCode}" existe déjà`);
    }

    // Règle 3: Unicité du badge "Recommandé"
    if (data.isRecommended) {
      await prisma.subscriptionPlan.updateMany({
        data: { isRecommended: false },
      });
    }

    return subscriptionsRepository.createPlan({
      ...data,
      code: cleanCode,
    });
  }

  async listPlans(includeInactive: boolean = false) {
    return subscriptionsRepository.listPlans(includeInactive);
  }

  async updatePlan(id: string, data: {
    name?: string;
    description?: string;
    priceMonthlyXof?: number;
    yearlyDiscountPercent?: number;
    maxProperties?: number;
    maxTenants?: number;
    features?: string[];
    isRecommended?: boolean;
    isActive?: boolean;
  }) {
    const existing = await subscriptionsRepository.findPlanById(id);
    if (!existing) {
      throw new NotFoundError(`Forfait d'abonnement introuvable (ID: ${id})`);
    }

    // Règle 2: Invariance du forfait Starter
    if (existing.code === 'starter') {
      if (data.priceMonthlyXof !== undefined && Number(data.priceMonthlyXof) !== 0) {
        throw new BadRequestError("Le forfait Starter est l'offre d'accueil gratuite de Naforo et doit obligatoirement rester à 0 FCFA.");
      }
      if (data.isActive === false) {
        throw new BadRequestError("Le forfait Starter est le socle d'accueil de la plateforme et ne peut pas être désactivé ou archivé.");
      }
    }

    // Règle 3: Exclusivité du badge "Recommandé"
    if (data.isRecommended === true) {
      await prisma.subscriptionPlan.updateMany({
        where: { id: { not: id } },
        data: { isRecommended: false },
      });
    }

    // Règle 4: Le code machine est immuable pour préserver les middlewares
    const { ...sanitizedData } = data;
    delete (sanitizedData as any).code;

    return subscriptionsRepository.updatePlan(id, sanitizedData);
  }

  async togglePlanActive(id: string, isActive: boolean) {
    const existing = await subscriptionsRepository.findPlanById(id);
    if (!existing) {
      throw new NotFoundError(`Forfait d'abonnement introuvable (ID: ${id})`);
    }

    // Règle 2: Le plan starter ne peut jamais être bloqué
    if (existing.code === 'starter' && !isActive) {
      throw new BadRequestError("Le forfait Starter est le socle d'onboarding obligatoire de Naforo. Il ne peut pas être bloqué ou archivé.");
    }

    return subscriptionsRepository.updatePlan(id, { isActive });
  }

  async deletePlan(id: string) {
    const existing = await subscriptionsRepository.findPlanById(id);
    if (!existing) {
      throw new NotFoundError(`Forfait d'abonnement introuvable (ID: ${id})`);
    }

    // Règle 2: Interdiction absolue de supprimer le plan starter
    if (existing.code === 'starter') {
      throw new BadRequestError("Le forfait Starter est le socle système de la plateforme Naforo et ne peut jamais être supprimé.");
    }

    // Règle 1: Intégrité référentielle & Grandfathering
    const [subCount, paymentCount] = await Promise.all([
      prisma.subscription.count({ where: { planId: id } }),
      prisma.subscriptionPayment.count({ where: { targetPlanId: id } }),
    ]);

    if (subCount > 0) {
      throw new BadRequestError(
        `Impossible de supprimer l'offre "${existing.name}" : ${subCount} organisation(s) y sont actuellement abonnées. Conformément aux règles SaaS de protection des données et d'historique contractuel, veuillez bloquer/archiver cette offre (règle de Grandfathering). Les agences abonnées conserveront leur forfait jusqu'à échéance, mais l'offre sera masquée pour les nouvelles souscriptions.`
      );
    }

    if (paymentCount > 0) {
      throw new BadRequestError(
        `Impossible de supprimer l'offre "${existing.name}" : ${paymentCount} historique(s) de paiement y sont rattachés. Veuillez utiliser le blocage/archivage pour préserver la traçabilité financière.`
      );
    }

    return subscriptionsRepository.deletePlan(id);
  }

  // --- MY SUBSCRIPTION & QUOTAS ---
  async getMySubscription(organizationId: string) {
    let subscription = await subscriptionsRepository.getActiveSubscription(organizationId);
    if (!subscription) {
      throw new NotFoundError("Aucun abonnement trouvé pour cette organisation");
    }

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true, isActive: true, name: true },
    });

    const now = new Date();
    const endDate = new Date(subscription.endDate);
    const isStarter = subscription.plan.code === 'starter';

    // Calcul précis des jours et de l'état du cycle de vie
    const diffTime = endDate.getTime() - now.getTime();
    const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const isExpired = !isStarter && daysRemaining <= 0;
    const daysSinceExpiration = isExpired ? Math.abs(daysRemaining) : 0;

    let status = subscription.status;
    let isSuspended = false;
    let isDeactivated = false;
    let suspensionReason: string | null = null;
    let deactivationReason: string | null = null;
    let remainingGraceDays: number | null = null;

    if (!isStarter && isExpired) {
      if (daysSinceExpiration <= 5) {
        // J0 à J+5 : Suspension (Mode Lecture Seule)
        status = 'suspended';
        isSuspended = true;
        suspensionReason = `Votre abonnement a expiré il y a ${daysSinceExpiration} jour(s). Votre espace est actuellement en mode LECTURE SEULE. Vous disposez de ${Math.max(0, 5 - daysSinceExpiration)} jour(s) pour régulariser avant désactivation totale de vos accès.`;
        
        // Mettre à jour l'état si pas encore fait
        if (subscription.status !== 'suspended') {
          await prisma.subscription.update({
            where: { id: subscription.id },
            data: { status: 'suspended' },
          });
        }
      } else {
        // J+5 et au-delà : Désactivation complète avec période de grâce de 90 jours
        status = 'deactivated';
        isDeactivated = true;

        const graceLimit = subscription.gracePeriodEndDate
          ? new Date(subscription.gracePeriodEndDate)
          : new Date(endDate.getTime() + 95 * 24 * 60 * 60 * 1000);

        remainingGraceDays = Math.max(0, Math.ceil((graceLimit.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
        deactivationReason = `Votre compte organisation a été désactivé pour impayé. Vos données sont conservées pendant la période de grâce de 90 jours (${remainingGraceDays} jours restants) avant suppression définitive.`;

        if (subscription.status !== 'deactivated' || org?.isActive) {
          await prisma.subscription.update({
            where: { id: subscription.id },
            data: { status: 'deactivated', gracePeriodEndDate: graceLimit },
          });
          await prisma.organization.update({
            where: { id: organizationId },
            data: { isActive: false },
          });
        }
      }
    } else if (subscription.status === 'suspended') {
      status = 'suspended';
      isSuspended = true;
      suspensionReason = "Votre abonnement est actuellement suspendu en mode lecture seule.";
    } else if (subscription.status === 'deactivated') {
      status = 'deactivated';
      isDeactivated = true;
      deactivationReason = "Votre compte est désactivé.";
    } else {
      status = 'active';
    }

    // Vérifier si un paiement a été soumis par l'utilisateur et attend la validation du super-admin
    const pendingPayment = await prisma.subscriptionPayment.findFirst({
      where: { organizationId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });

    let pendingPaymentInfo = null;
    if (pendingPayment) {
      let targetPlanName = subscription.plan.name;
      if (pendingPayment.targetPlanId) {
        const targetPlan = await prisma.subscriptionPlan.findUnique({ where: { id: pendingPayment.targetPlanId } });
        if (targetPlan) targetPlanName = targetPlan.name;
      }
      pendingPaymentInfo = {
        id: pendingPayment.id,
        paymentReference: pendingPayment.paymentReference,
        amountXof: Number(pendingPayment.amountXof),
        paymentMethod: pendingPayment.paymentMethod,
        transactionNumber: pendingPayment.transactionNumber,
        paymentDate: pendingPayment.paymentDate,
        proofUrl: pendingPayment.proofUrl,
        createdAt: pendingPayment.createdAt,
        targetPlanName,
      };
    }

    // Calcul de la consommation actuelle des quotas de l'organisation
    const [propertyCount, tenantCount] = await Promise.all([
      prisma.property.count({ where: { organizationId } }),
      prisma.tenantProfile.count({ where: { organizationId, isActive: true } }),
    ]);

    // Décoder les fonctionnalités (tableau stocké sous forme de chaîne JSON)
    let featuresList: string[] = [];
    try {
      featuresList = typeof subscription.plan.features === 'string'
        ? JSON.parse(subscription.plan.features)
        : (subscription.plan.features as string[] || []);
    } catch {
      featuresList = [];
    }

    return {
      id: subscription.id,
      planName: subscription.plan.name,
      planCode: subscription.plan.code,
      startDate: subscription.startDate,
      endDate: subscription.endDate,
      status,
      isExpired,
      isSuspended,
      isDeactivated,
      suspensionReason,
      deactivationReason,
      remainingGraceDays,
      daysRemaining: Math.max(0, daysRemaining),
      daysSinceExpiration,
      hasPendingPayment: !!pendingPayment,
      pendingPayment: pendingPaymentInfo,
      quotas: {
        properties: {
          used: propertyCount,
          max: subscription.plan.maxProperties,
          reached: propertyCount >= subscription.plan.maxProperties,
        },
        tenants: {
          used: tenantCount,
          max: subscription.plan.maxTenants,
          reached: tenantCount >= subscription.plan.maxTenants,
        },
      },
      features: featuresList,
    };
  }

  // --- PAYMENTS & DECLARATION ---
  async declarePayment(
    organizationId: string,
    userId: string,
    data: {
      planId: string;
      billingCycle: 'monthly' | 'yearly';
      paymentMethod: string;
      transactionNumber?: string;
      paymentDate: Date;
    }
  ) {
    const plan = await subscriptionsRepository.findPlanById(data.planId);
    if (!plan || !plan.isActive) {
      throw new NotFoundError("Le plan sélectionné n'existe pas ou est inactif");
    }

    // Calcul du prix final
    let price = Number(plan.priceMonthlyXof);
    if (data.billingCycle === 'yearly') {
      // Forfait annuel : prix mensuel * 12 avec 20% de remise
      price = price * 12 * 0.8;
    }

    // Récupérer l'abonnement actuel sans en modifier le planId
    let activeSub = await subscriptionsRepository.getActiveSubscription(organizationId);

    if (!activeSub) {
      // Si aucun abonnement n'existe, on en crée un temporaire
      activeSub = await subscriptionsRepository.createSubscription({
        organizationId,
        planId: plan.id,
        startDate: new Date(),
        endDate: new Date(),
        status: 'suspended',
      }) as any;
    }

    const paymentReference = generateReference('SUB');

    // IMPORTANT : On enregistre le paiement en attente avec le targetPlanId réclamé
    // SANS activer ni changer l'abonnement en cours avant validation superadmin !
    const payment = await subscriptionsRepository.createPayment({
      paymentReference,
      organizationId,
      subscriptionId: activeSub!.id,
      targetPlanId: plan.id,
      billingCycle: data.billingCycle,
      amountXof: price,
      paymentMethod: data.paymentMethod,
      transactionNumber: data.transactionNumber,
      paymentDate: data.paymentDate,
    });

    // Notifier le Super Admin en base
    try {
      const org = await prisma.organization.findUnique({ where: { id: organizationId } });
      await prisma.notification.create({
        data: {
          organizationId: null, // Global
          type: 'SUBSCRIPTION_PAYMENT_PENDING',
          title: '💳 Nouveau paiement d\'abonnement à valider',
          message: `L'organisation "${org?.name}" a déclaré un paiement de ${price.toLocaleString('fr-FR')} FCFA pour l'offre ${plan.name} (Réf: ${paymentReference}). Preuve en attente.`,
          channels: ['in_app'],
        },
      });
    } catch (e) {}

    logger.info(`[Subscription] Paiement d'abonnement ${paymentReference} déclaré (EN ATTENTE) pour le plan ${plan.name} (${plan.code})`);
    return payment;
  }

  async uploadProof(paymentId: string, fileUrl: string, organizationId: string) {
    const payment = await subscriptionsRepository.findPaymentById(paymentId);
    if (!payment || payment.organizationId !== organizationId) {
      throw new NotFoundError("Paiement d'abonnement introuvable");
    }

    const updated = await subscriptionsRepository.updatePaymentProof(paymentId, fileUrl);

    // Alerter le super-admin qu'une preuve vient d'être envoyée
    try {
      const org = await prisma.organization.findUnique({ where: { id: organizationId } });
      await prisma.notification.create({
        data: {
          organizationId: null,
          type: 'SUBSCRIPTION_PROOF_UPLOADED',
          title: '📑 Preuve de paiement d\'abonnement reçue',
          message: `La preuve de paiement pour la souscription de "${org?.name}" (${payment.paymentReference}) a été téléversée. En attente de votre validation.`,
          channels: ['in_app'],
        },
      });
    } catch (e) {}

    return updated;
  }

  async getPaymentsHistory(organizationId: string) {
    return subscriptionsRepository.listPaymentsHistory(organizationId);
  }

  // --- SUPERADMIN: PENDING & VALIDATIONS ---
  async getPendingPayments(userId: string, status?: string) {
    // Vérification du rôle Superadmin
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'super_admin') {
      throw new ForbiddenError("Accès réservé au super administrateur de la plateforme");
    }
    return subscriptionsRepository.listPendingPayments(status);
  }

  async validatePayment(
    paymentId: string,
    superadminId: string,
    data: { status: 'validated' | 'rejected'; rejectionReason?: string }
  ) {
    const payment = await subscriptionsRepository.findPaymentById(paymentId);
    if (!payment) {
      throw new NotFoundError("Paiement d'abonnement introuvable");
    }

    if (payment.status !== 'pending') {
      throw new BadRequestError("Ce paiement a déjà été traité");
    }

    if (data.status === 'rejected') {
      if (!data.rejectionReason) {
        throw new BadRequestError("Un motif de rejet est requis");
      }
      return subscriptionsRepository.rejectPayment(paymentId, data.rejectionReason);
    }

    // --- ACTIVATION STRICTE PAR LE SUPERADMIN ---
    const organizationId = payment.organizationId;
    const activeSub = payment.subscription;
    
    // 1. Déterminer le plan payant à appliquer à partir du targetPlanId déclaré
    let plan = activeSub.plan;
    if (payment.targetPlanId) {
      const targetPlan = await subscriptionsRepository.findPlanById(payment.targetPlanId);
      if (targetPlan) {
        plan = targetPlan;
      }
    } else if (plan.code === 'starter') {
      const proPlan = await subscriptionsRepository.findPlanByCode('pro') || await prisma.subscriptionPlan.findFirst({ where: { code: { not: 'starter' } } });
      if (proPlan) {
        plan = proPlan;
      }
    }

    // 2. Calcul de la période de validité de la souscription
    const billingCycle = payment.billingCycle || (Number(payment.amountXof) > Number(plan.priceMonthlyXof) * 6 ? 'yearly' : 'monthly');
    const durationDays = billingCycle === 'yearly' ? 365 : 30;

    let startDate = new Date();
    // Si l'abonnement actuel est encore actif dans le futur, on prolonge à partir de la date de fin
    if (activeSub.status === 'active' && new Date(activeSub.endDate) > new Date()) {
      startDate = new Date(activeSub.endDate);
    }

    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);
    // 90 jours de grâce après l'échéance avant suppression définitive
    const gracePeriodEndDate = new Date(endDate.getTime() + 90 * 24 * 60 * 60 * 1000);

    // 3. Mettre à jour l'abonnement de l'organisation avec le nouveau plan
    await prisma.subscription.update({
      where: { id: activeSub.id },
      data: {
        planId: plan.id,
        startDate,
        endDate,
        gracePeriodEndDate,
        status: 'active',
      },
    });

    // 4. Mettre à jour le statut et plan dans la fiche de l'organisation
    await prisma.organization.update({
      where: { id: organizationId },
      data: { plan: plan.code, isActive: true },
    });

    // 5. Conversion multi-devises
    const convertedAmounts = await convertAmountXof(Number(payment.amountXof));

    // Récupérer les informations complètes de l'organisation et des administrateurs
    const [org, ownerUsers] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true, email: true, phone: true, address: true, city: true },
      }),
      prisma.user.findMany({
        where: {
          organizationId,
          role: { in: ['owner', 'admin'] },
          isActive: true,
        },
        select: { id: true, email: true, firstName: true, lastName: true },
      }),
    ]);

    const docParams = {
      paymentReference: payment.paymentReference,
      amountXof: Number(payment.amountXof),
      paymentMethod: payment.paymentMethod,
      transactionNumber: payment.transactionNumber,
      paymentDate: payment.paymentDate,
      billingCycle,
      organization: {
        name: org?.name || 'Organisation Cliente',
        email: org?.email || (ownerUsers[0]?.email || null),
        phone: org?.phone || null,
        address: org?.address || null,
        city: org?.city || null,
      },
      subscription: {
        startDate,
        endDate,
        plan: {
          name: plan.name,
          code: plan.code,
          description: plan.description,
          maxProperties: plan.maxProperties,
          maxTenants: plan.maxTenants,
          features: plan.features,
        },
      },
    };

    // Générer la facture PDFKit haute fidélité SaaS Naforo
    const relativePdfPath = await generateSubscriptionInvoicePdf(docParams, convertedAmounts);
    const absolutePdfPath = path.join(process.cwd(), relativePdfPath);

    // Mettre à jour le paiement avec le PDF de la facture
    const updatedPayment = await subscriptionsRepository.validatePayment(
      paymentId,
      superadminId,
      relativePdfPath
    );

    // Résolution des adresses email destinataires (Organisation + Administrateurs de compte)
    const recipientEmailsSet = new Set<string>();
    if (org?.email && org.email.trim()) {
      recipientEmailsSet.add(org.email.trim());
    }
    for (const u of ownerUsers) {
      if (u.email && u.email.trim()) {
        recipientEmailsSet.add(u.email.trim());
      }
    }
    const recipientEmails = Array.from(recipientEmailsSet);

    // Envoi de l'email avec la facture PDF en pièce jointe
    if (recipientEmails.length > 0) {
      const primaryRecipientName = ownerUsers[0]
        ? `${ownerUsers[0].firstName} ${ownerUsers[0].lastName}`
        : (org?.name || 'Client Naforo');

      const emailHtml = subscriptionPaymentApproved({
        orgName: org?.name || 'Votre Organisation',
        recipientName: primaryRecipientName,
        planName: plan.name,
        billingCycle: billingCycle === 'yearly' ? 'Annuel (12 mois)' : 'Mensuel (30 jours)',
        amount: formatCurrency(Number(payment.amountXof)),
        reference: payment.paymentReference,
        paymentMethod: payment.paymentMethod.replace(/_/g, ' ').toUpperCase(),
        transactionNumber: payment.transactionNumber,
        startDate: formatDate(startDate),
        endDate: formatDate(endDate),
        dashboardUrl: `${env.BACKOFFICE_URL || env.FRONTEND_URL}/dashboard`,
      });

      const emailSubject = `Facture d'Abonnement Naforo [${payment.paymentReference}] - Offre ${plan.name} Validée ✓`;
      const attachments = [
        {
          filename: `Facture-Naforo-${payment.paymentReference}.pdf`,
          path: absolutePdfPath,
          contentType: 'application/pdf',
        },
      ];

      try {
        await sendMail(recipientEmails, emailSubject, emailHtml, undefined, attachments);
        logger.info(`[Subscription] Facture d'abonnement ${payment.paymentReference} envoyée par email à : ${recipientEmails.join(', ')}`);
      } catch (mailErr: any) {
        logger.warn(`[Subscription] Envoi direct de l'email échoué (${mailErr.message}), bascule vers emailQueue...`);
        try {
          await emailQueue.add('send-email', {
            to: recipientEmails,
            subject: emailSubject,
            html: emailHtml,
            attachments,
          });
        } catch (queueErr: any) {
          logger.error(`[Subscription] Impossible d'ajouter l'email à la file d'attente: ${queueErr.message}`);
        }
      }
    } else {
      logger.warn(`[Subscription] Aucun email de contact trouvé pour l'organisation ${organizationId}. La facture n'a pas pu être envoyée par email.`);
    }

    // Créer une notification interne dans la plateforme
    try {
      await prisma.notification.create({
        data: {
          organizationId,
          type: 'SUBSCRIPTION_PAYMENT_VALIDATED',
          title: '✅ Abonnement activé & Facture disponible',
          message: `Votre paiement pour le forfait ${plan.name} a été validé par le super administrateur. Votre facture ${payment.paymentReference} est prête au téléchargement.`,
          channels: ['in_app'],
        },
      });
    } catch (notifErr: any) {
      logger.warn(`[Subscription] Notification in-app non créée: ${notifErr.message}`);
    }

    logger.info(`[Subscription] Paiement ${payment.paymentReference} VALIDÉ par le superadmin ${superadminId}. Abonnement ${plan.name} activé jusqu'au ${endDate.toISOString()}`);
    return updatedPayment;
  }

  // --- EXPORT INTÉGRAL DE SAUVEGARDE (POLITIQUE DE RÉTENTION) ---
  async exportTenantData(organizationId: string) {
    const [
      org,
      properties,
      tenantProfiles,
      contracts,
      invoices,
      payments,
      receipts,
      incidents,
      accountingTransactions,
      documents
    ] = await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId } }),
      prisma.property.findMany({ where: { organizationId } }),
      prisma.tenantProfile.findMany({ where: { organizationId } }),
      prisma.contract.findMany({ where: { organizationId } }),
      prisma.invoice.findMany({ where: { organizationId } }),
      prisma.payment.findMany({ where: { organizationId } }),
      prisma.receipt.findMany({ where: { organizationId } }),
      prisma.incident.findMany({ where: { organizationId } }),
      prisma.accountingTransaction.findMany({ where: { organizationId } }),
      prisma.document.findMany({ where: { organizationId } }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      platform: 'NAFORO - Gestion Locative Intelligente',
      backupVersion: '1.0',
      policy: 'Politique de rétention et de sauvegarde des données clients (RGPD & Export)',
      organization: org,
      summary: {
        propertiesCount: properties.length,
        tenantsCount: tenantProfiles.length,
        contractsCount: contracts.length,
        invoicesCount: invoices.length,
        paymentsCount: payments.length,
        receiptsCount: receipts.length,
        incidentsCount: incidents.length,
        accountingTransactionsCount: accountingTransactions.length,
        documentsCount: documents.length,
      },
      data: {
        properties,
        tenantProfiles,
        contracts,
        invoices,
        payments,
        receipts,
        incidents,
        accountingTransactions,
        documents,
      },
    };
  }

  async getAdminStats(superadminId: string): Promise<any> {
    // Vérifier les permissions
    const user = await prisma.user.findUnique({
      where: { id: superadminId },
      select: { role: true },
    });
    if (user?.role !== 'super_admin') {
      throw new ForbiddenError("Accès réservé aux superadministrateurs.");
    }

    const [
      totalOrganizations,
      activeSubscriptions,
      revenueAgg,
      pendingValidationCount,
      recentOrgs
    ] = await Promise.all([
      prisma.organization.count(),
      prisma.subscription.count({
        where: {
          status: 'active',
          plan: { code: { not: 'starter' } }
        }
      }),
      prisma.subscriptionPayment.aggregate({
        where: { status: 'validated' },
        _sum: { amountXof: true }
      }),
      prisma.subscriptionPayment.count({
        where: { status: 'pending' }
      }),
      prisma.organization.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          name: true,
          plan: true,
          createdAt: true
        }
      })
    ]);

    return {
      totalOrganizations,
      activeSubscriptions,
      totalRevenueXof: Number(revenueAgg._sum.amountXof || 0),
      pendingValidationCount,
      recentOrgs
    };
  }

  // --- AUTOMATIONS & HOOKS ---
  async createStarterSubscription(organizationId: string): Promise<void> {
    // 1. Chercher le plan Starter
    let plan = await subscriptionsRepository.findPlanByCode('starter');
    if (!plan) {
      // S'il n'existe pas, on le génère par défaut
      plan = await subscriptionsRepository.createPlan({
        name: 'Starter',
        code: 'starter',
        description: 'Offre gratuite de bienvenue',
        priceMonthlyXof: 0,
        maxProperties: 2,
        maxTenants: 2,
        features: ['dashboard'],
      });
    }

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 60); // Valable 60 jours selon la validation de l'utilisateur

    await subscriptionsRepository.createSubscription({
      organizationId,
      planId: plan.id,
      startDate,
      endDate,
      status: 'active',
    });

    logger.info(`[Subscription] Abonnement starter gratuit de 60 jours créé pour l'organisation ${organizationId}`);
  }
}

