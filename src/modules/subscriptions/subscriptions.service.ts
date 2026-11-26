import { subscriptionsRepository } from './subscriptions.repository';
import { convertAmountXof } from '@/modules/accounting/accounting.repository';
import { generateSubscriptionInvoicePdf } from './pdf.generator';
import { prisma } from '@/config/database';
import { NotFoundError, BadRequestError, ForbiddenError, UnauthorizedError } from '@/shared/errors/AppError';
import { logger } from '@/config/logger';
import { generateReference } from '@/shared/helpers/crypto';
import { emailQueue } from '@/queues';
import path from 'path';
import { sendMail, subscriptionPaymentApproved } from '@/config/mailer';
import { formatCurrency, formatDate } from '@/shared/helpers/date';
import { env } from '@/config/env';
import {
  saspayClient,
  verifySaspayWebhookSignature,
  mapSaspayStatus,
} from './saspay.client';
import {
  STARTER_TRIAL_MONTHS,
  DEFAULT_PLAN_FEATURES,
  DEFAULT_PLAN_QUOTAS,
  computeStarterTrialEnd,
  getOrganizationUsage,
  getPlanExtendedQuotas,
  parsePlanFeatures,
  planIncludesFeature,
} from '@/shared/helpers/plan-policy';

export class SubscriptionsService {

  // --- PLANS ---
  async createPlan(data: {
    name: string;
    code: string;
    description?: string;
    priceMonthlyXof: number;
    yearlyDiscountPercent?: number;
    maxProperties: number;
    maxLots?: number;
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
    maxLots?: number;
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
    const isTrialExpired = isStarter && daysRemaining <= 0;
    const isPaidExpired = !isStarter && daysRemaining <= 0;
    const isExpired = isTrialExpired || isPaidExpired;
    const daysSinceExpiration = isExpired ? Math.abs(daysRemaining) : 0;

    let status = subscription.status;
    let isSuspended = false;
    let isDeactivated = false;
    let suspensionReason: string | null = null;
    let deactivationReason: string | null = null;
    let remainingGraceDays: number | null = null;

    if (isTrialExpired) {
      status = 'trial_expired';
      isSuspended = true;
      suspensionReason = "Votre période d'essai gratuit du forfait Starter est arrivée à son terme. Vos données sont conservées en toute sécurité en mode LECTURE SEULE. Veuillez souscrire à une formule Pro ou Expert pour réactiver vos accès d'écriture.";
    } else if (!isStarter && isExpired) {
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

    // Calcul de la consommation actuelle des quotas de l'organisation (lots et biens distincts)
    const usage = await getOrganizationUsage(organizationId);
    const propertyCount = usage.properties;
    const lotCount = usage.lots;
    const tenantCount = usage.tenants;

    // Durée totale de la période d'essai Starter (3 mois calendaires), calculée depuis les dates réelles
    const trialDaysTotal = Math.max(
      1,
      Math.round((endDate.getTime() - new Date(subscription.startDate).getTime()) / (1000 * 60 * 60 * 24))
    );

    // Décoder les fonctionnalités (tableau stocké sous forme de chaîne JSON)
    let featuresList: string[] = [];
    try {
      featuresList = typeof subscription.plan.features === 'string'
        ? JSON.parse(subscription.plan.features)
        : (subscription.plan.features as string[] || []);
    } catch {
      featuresList = [];
    }

    const extQuotas = getPlanExtendedQuotas(subscription.plan.code, featuresList);

    return {
      id: subscription.id,
      planName: subscription.plan.name,
      planCode: subscription.plan.code,
      startDate: subscription.startDate,
      endDate: subscription.endDate,
      status,
      isStarter,
      isExpired,
      isTrialExpired,
      isStarterTrialExpired: isTrialExpired,
      starterTrialDaysTotal: trialDaysTotal,
      starterTrialMonths: STARTER_TRIAL_MONTHS,
      starterTrialDaysLeft: isStarter ? Math.max(0, daysRemaining) : null,
      isSuspended,
      isDeactivated,
      suspensionReason,
      deactivationReason,
      remainingGraceDays,
      daysRemaining: Math.max(0, daysRemaining),
      daysSinceExpiration,
      hasPendingPayment: !!pendingPayment,
      pendingPayment: pendingPaymentInfo,
      supportContact: {
        email: 'contact@naforo.company',
        supportEmail: 'support@naforo.company',
        phone: '+225 07 00 00 00 00',
        whatsapp: '+2250700000000',
      },
      quotas: {
        properties: {
          used: propertyCount,
          max: subscription.plan.maxProperties,
          reached: propertyCount >= subscription.plan.maxProperties,
        },
        lots: {
          used: lotCount,
          max: subscription.plan.maxLots,
          reached: lotCount >= subscription.plan.maxLots,
        },
        tenants: {
          used: tenantCount,
          max: subscription.plan.maxTenants,
          reached: tenantCount >= subscription.plan.maxTenants,
        },
        staff: {
          used: usage.staff,
          max: extQuotas.maxStaff,
          reached: extQuotas.maxStaff < 9999 && usage.staff >= extQuotas.maxStaff,
        },
        landlords: {
          used: usage.landlords,
          max: extQuotas.maxLandlords,
          reached: extQuotas.maxLandlords < 9999 && usage.landlords >= extQuotas.maxLandlords,
        },
        whatsappMonthly: {
          used: usage.whatsappMonthly,
          max: extQuotas.maxWhatsappMonthly,
          reached: extQuotas.maxWhatsappMonthly < 9999 && usage.whatsappMonthly >= extQuotas.maxWhatsappMonthly,
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

    // Contrôle préventif en cas de rétrogradation (downgrade) : vérifier que l'usage actuel tient dans le forfait cible
    const usage = await getOrganizationUsage(organizationId);
    const activeStaffCount = await prisma.user.count({
      where: {
        organizationId,
        isActive: true,
        role: { in: ['admin', 'manager', 'accountant', 'owner'] },
      },
    });
    const targetFeatures = parsePlanFeatures(plan.features);
    const { maxStaff: targetMaxStaff } = getPlanExtendedQuotas(plan.code, targetFeatures);

    const exceeded: string[] = [];
    if (plan.maxProperties < 9999 && usage.properties > plan.maxProperties) {
      exceeded.push(`${usage.properties} bien(s) actif(s) pour un maximum de ${plan.maxProperties}`);
    }
    if (plan.maxLots < 9999 && usage.lots > plan.maxLots) {
      exceeded.push(`${usage.lots} lot(s)/immeuble(s) pour un maximum de ${plan.maxLots}`);
    }
    if (plan.maxTenants < 9999 && usage.tenants > plan.maxTenants) {
      exceeded.push(`${usage.tenants} locataire(s) actif(s) pour un maximum de ${plan.maxTenants}`);
    }
    if (targetMaxStaff < 9999 && activeStaffCount > targetMaxStaff) {
      exceeded.push(`${activeStaffCount} collaborateur(s) actif(s) pour un maximum de ${targetMaxStaff}`);
    }

    if (exceeded.length > 0) {
      throw new BadRequestError(
        `Impossible de passer au forfait ${plan.name} car votre utilisation actuelle dépasse ses quotas : ${exceeded.join(' ; ')}. Veuillez réduire ou archiver les éléments excédentaires avant de rétrograder.`
      );
    }

    // Calcul du prix final directement depuis le forfait en base (SubscriptionPlan)
    const baseMonthly = Number(plan.priceMonthlyXof);
    const discountPercent = Number(plan.yearlyDiscountPercent ?? 20);
    const price =
      data.billingCycle === 'yearly'
        ? Math.round(baseMonthly * 12 * (1 - discountPercent / 100))
        : Math.round(baseMonthly);

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

    return this.activateSubscriptionPayment(payment, superadminId, 'le super administrateur');
  }

  /**
   * Activation atomique & idempotente d'un paiement d'abonnement (Superadmin ou SasPay)
   * Met à jour le plan, prolonge les dates, génère la facture PDF, envoie l'email et notifie.
   */
  private async activateSubscriptionPayment(
    payment: any,
    validatedBy: string,
    sourceLabel: string = 'la passerelle SasPay'
  ) {
    if (payment.status === 'validated') {
      return payment;
    }

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
      const proPlan =
        (await subscriptionsRepository.findPlanByCode('pro')) ||
        (await prisma.subscriptionPlan.findFirst({ where: { code: { not: 'starter' } } }));
      if (proPlan) {
        plan = proPlan;
      }
    }

    // 2. Calcul de la période de validité de la souscription
    const billingCycle =
      payment.billingCycle ||
      (Number(payment.amountXof) > Number(plan.priceMonthlyXof) * 6 ? 'yearly' : 'monthly');
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
      payment.id,
      validatedBy,
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
        await sendMail(recipientEmails, emailSubject, emailHtml, undefined, attachments, 'admin');
        logger.info(`[Subscription] Facture d'abonnement ${payment.paymentReference} envoyée par email à : ${recipientEmails.join(', ')}`);
      } catch (mailErr: any) {
        logger.warn(`[Subscription] Envoi direct de l'email échoué (${mailErr.message}), bascule vers emailQueue...`);
        try {
          await emailQueue.add('send-email', {
            to: recipientEmails,
            subject: emailSubject,
            html: emailHtml,
            attachments,
            service: 'admin',
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
          message: `Votre paiement pour le forfait ${plan.name} a été validé par ${sourceLabel}. Votre facture ${payment.paymentReference} est prête au téléchargement.`,
          channels: ['in_app'],
        },
      });
    } catch (notifErr: any) {
      logger.warn(`[Subscription] Notification in-app non créée: ${notifErr.message}`);
    }

    logger.info(`[Subscription] Paiement ${payment.paymentReference} VALIDÉ (${validatedBy}). Abonnement ${plan.name} activé jusqu'au ${endDate.toISOString()}`);
    return updatedPayment;
  }

  // ===========================================================================
  // AGRÉGATEUR DE PAIEMENT SASPAY (https://docs.saspay.me/)
  // ===========================================================================

  getSaspayConfig() {
    return {
      configured: saspayClient.isConfigured(),
      mode: saspayClient.getMode(),
      webhookConfigured: Boolean(env.SASPAY_WEBHOOK_SECRET),
      supportedModes: ['checkout', 'softpay'] as const,
      supportedNetworks: [
        { code: 'wave_ci', label: 'Wave Côte d’Ivoire', country: 'CI' },
        { code: 'orange_ci', label: 'Orange Money CI', country: 'CI' },
        { code: 'mtn_ci', label: 'MTN Mobile Money CI', country: 'CI' },
        { code: 'moov_ci', label: 'Moov Money CI', country: 'CI' },
        { code: 'mtn_bj', label: 'MTN MoMo Bénin', country: 'BJ' },
        { code: 'moov_bj', label: 'Moov Money Bénin', country: 'BJ' },
        { code: 'wave_sn', label: 'Wave Sénégal', country: 'SN' },
        { code: 'orange_sn', label: 'Orange Money Sénégal', country: 'SN' },
      ],
    };
  }

  /**
   * Initie un encaissement d'abonnement via SasPay (Checkout hébergé ou Softpay Push direct)
   */
  async initiateSaspayPayment(
    organizationId: string,
    userId: string,
    data: {
      planId: string;
      billingCycle: 'monthly' | 'yearly';
      mode: 'checkout' | 'softpay';
      country?: string;
      network?: string;
      phone?: string;
      returnUrl?: string;
    }
  ) {
    if (!saspayClient.isConfigured()) {
      throw new BadRequestError(
        "Le paiement en ligne SasPay n'est pas encore activé sur cet environnement (clé API SasPay manquante). Utilisez la déclaration manuelle ou configurez SASPAY_SECRET_KEY."
      );
    }

    const plan = await subscriptionsRepository.findPlanById(data.planId);
    if (!plan || !plan.isActive) {
      throw new NotFoundError("Le plan sélectionné n'existe pas ou est inactif");
    }

    // Calcul du prix final conforme aux paramètres du plan
    const baseMonthly = Number(plan.priceMonthlyXof);
    if (baseMonthly <= 0) {
      throw new BadRequestError("Le forfait gratuit ne nécessite pas de paiement via SasPay.");
    }

    const discountPercent = Number(plan.yearlyDiscountPercent ?? 20);
    const price =
      data.billingCycle === 'yearly'
        ? Math.round(baseMonthly * 12 * (1 - discountPercent / 100))
        : Math.round(baseMonthly);

    // Contrôle préventif des quotas en cas de rétrogradation (downgrade)
    const usage = await getOrganizationUsage(organizationId);
    const activeStaffCount = await prisma.user.count({
      where: {
        organizationId,
        isActive: true,
        role: { in: ['admin', 'manager', 'accountant', 'owner'] },
      },
    });
    const targetFeatures = parsePlanFeatures(plan.features);
    const { maxStaff: targetMaxStaff } = getPlanExtendedQuotas(plan.code, targetFeatures);

    const exceeded: string[] = [];
    if (plan.maxProperties < 9999 && usage.properties > plan.maxProperties) {
      exceeded.push(`${usage.properties} bien(s) actif(s) pour un maximum de ${plan.maxProperties}`);
    }
    if (plan.maxLots < 9999 && usage.lots > plan.maxLots) {
      exceeded.push(`${usage.lots} lot(s)/immeuble(s) pour un maximum de ${plan.maxLots}`);
    }
    if (plan.maxTenants < 9999 && usage.tenants > plan.maxTenants) {
      exceeded.push(`${usage.tenants} locataire(s) actif(s) pour un maximum de ${plan.maxTenants}`);
    }
    if (targetMaxStaff < 9999 && activeStaffCount > targetMaxStaff) {
      exceeded.push(`${activeStaffCount} collaborateur(s) actif(s) pour un maximum de ${targetMaxStaff}`);
    }

    if (exceeded.length > 0) {
      throw new BadRequestError(
        `Impossible de passer au forfait ${plan.name} car votre utilisation actuelle dépasse ses quotas : ${exceeded.join(' ; ')}.`
      );
    }

    // Récupérer l'abonnement actif, l'organisation et l'utilisateur payeur
    const [existingSub, org, payer] = await Promise.all([
      subscriptionsRepository.getActiveSubscription(organizationId),
      prisma.organization.findUnique({ where: { id: organizationId } }),
      prisma.user.findUnique({ where: { id: userId } }),
    ]);

    let activeSub = existingSub;
    if (!activeSub) {
      activeSub = (await subscriptionsRepository.createSubscription({
        organizationId,
        planId: plan.id,
        startDate: new Date(),
        endDate: new Date(),
        status: 'suspended',
      })) as any;
    }

    const paymentReference = generateReference('SUB');
    const cycleLabel = data.billingCycle === 'yearly' ? 'Annuel (12 mois)' : 'Mensuel (30 jours)';
    const description = `Abonnement Naforo ${plan.name} (${cycleLabel}) - ${paymentReference}`;
    const backofficeBase = (env.BACKOFFICE_URL || env.FRONTEND_URL).replace(/\/$/, '');
    const returnUrl = data.returnUrl
      ? `${data.returnUrl}${data.returnUrl.includes('?') ? '&' : '?'}saspay_ref=${encodeURIComponent(paymentReference)}`
      : `${backofficeBase}/subscription?saspay_ref=${encodeURIComponent(paymentReference)}`;

    const customerEmail = payer?.email || org?.email || 'client@naforo.company';
    const customerFirstName = payer?.firstName || org?.name || 'Client';
    const customerLastName = payer?.lastName || 'Naforo';
    const customerName = `${customerFirstName} ${customerLastName}`.trim();

    let saspayId = '';
    let checkoutUrl: string | undefined;
    let instructions: string | undefined;
    let saspayStatus: string = 'pending';

    if (data.mode === 'softpay') {
      const softpayRes = await saspayClient.initiateSoftpay({
        amountXof: price,
        currency: 'XOF',
        country: (data.country || 'CI').toUpperCase(),
        network: data.network!,
        description,
        customer: {
          email: customerEmail,
          firstName: customerFirstName,
          lastName: customerLastName,
          phone: data.phone!,
        },
        idempotencyKey: paymentReference,
      });

      saspayId = softpayRes.id;
      checkoutUrl = softpayRes.checkoutUrl;
      instructions = softpayRes.instructions || softpayRes.message;
      saspayStatus = softpayRes.status;
    } else {
      const sessionRes = await saspayClient.createCheckoutSession({
        amountXof: price,
        currency: 'XOF',
        description,
        customerEmail,
        customerName,
        returnUrl,
        idempotencyKey: paymentReference,
      });

      saspayId = sessionRes.id;
      checkoutUrl = sessionRes.checkoutUrl;
      saspayStatus = sessionRes.status;
    }

    // Enregistrer le paiement d'abonnement en attente avec l'identifiant SasPay
    const payment = await subscriptionsRepository.createPayment({
      paymentReference,
      organizationId,
      subscriptionId: activeSub!.id,
      targetPlanId: plan.id,
      billingCycle: data.billingCycle,
      amountXof: price,
      paymentMethod: 'saspay',
      transactionNumber: saspayId,
      paymentDate: new Date(),
    });

    // Journaliser l'initiation dans AuditLog (permet de retrouver le mode checkout vs softpay lors de la vérification)
    try {
      await prisma.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'SASPAY_PAYMENT_INITIATED',
          entityType: 'SUBSCRIPTION_PAYMENT',
          entityId: payment.id,
          newData: {
            paymentReference,
            saspayId,
            mode: data.mode,
            gatewayMode: saspayClient.getMode(),
            planCode: plan.code,
            billingCycle: data.billingCycle,
            amountXof: price,
            checkoutUrl: checkoutUrl || null,
          },
        },
      });
    } catch (auditErr: any) {
      logger.warn(`[SasPay] Impossible d'enregistrer AuditLog: ${auditErr.message}`);
    }

    logger.info(
      `[SasPay] Paiement ${paymentReference} initié (${data.mode}, ${saspayClient.getMode()}) — saspayId=${saspayId}, montant=${price} XOF`
    );

    return {
      payment,
      paymentReference,
      saspayId,
      mode: data.mode,
      gatewayMode: saspayClient.getMode(),
      checkoutUrl: checkoutUrl || null,
      instructions: instructions || null,
      status: saspayStatus,
    };
  }

  /**
   * Vérifie l'état réel d'un paiement SasPay côté serveur et active immédiatement l'abonnement si confirmé
   */
  async verifySaspayPayment(referenceOrId: string, organizationId: string) {
    const payment = await subscriptionsRepository.findPaymentByReferenceOrTransaction(referenceOrId);
    if (!payment || payment.organizationId !== organizationId) {
      throw new NotFoundError("Paiement d'abonnement SasPay introuvable");
    }

    if (payment.status === 'validated') {
      return {
        status: 'validated',
        activated: true,
        payment,
        message: 'Votre abonnement est déjà activé et confirmé.',
      };
    }

    if (payment.status === 'rejected') {
      return {
        status: 'rejected',
        activated: false,
        payment,
        message: payment.rejectionReason || 'Ce paiement a été refusé ou annulé.',
      };
    }

    if (!payment.transactionNumber) {
      throw new BadRequestError("Identifiant de transaction SasPay manquant pour ce paiement.");
    }

    // Déterminer le mode d'initiation (checkout vs softpay) depuis AuditLog
    const initLog = await prisma.auditLog.findFirst({
      where: {
        entityType: 'SUBSCRIPTION_PAYMENT',
        entityId: payment.id,
        action: 'SASPAY_PAYMENT_INITIATED',
      },
      orderBy: { createdAt: 'desc' },
    });
    const initMode = (initLog?.newData as any)?.mode || 'checkout';

    let gatewayCheck;
    if (initMode === 'softpay') {
      gatewayCheck = await saspayClient.verifyPayment(payment.transactionNumber);
    } else {
      const sessionCheck = await saspayClient.getCheckoutSession(payment.transactionNumber);
      // Si la session expose un transactionId, revérifier directement via /payments/{id}/verify/ (bonne pratique docs.saspay.me)
      if (sessionCheck.transactionId) {
        try {
          gatewayCheck = await saspayClient.verifyPayment(sessionCheck.transactionId);
        } catch {
          gatewayCheck = sessionCheck;
        }
      } else {
        gatewayCheck = sessionCheck;
      }
    }

    if (gatewayCheck.status === 'success') {
      const activatedPayment = await this.activateSubscriptionPayment(
        payment,
        'saspay_gateway',
        'la passerelle SasPay (paiement instantané)'
      );
      return {
        status: 'validated',
        activated: true,
        payment: activatedPayment,
        gatewayStatus: gatewayCheck.rawStatus,
        message: 'Paiement confirmé par SasPay ! Votre abonnement a été activé automatiquement.',
      };
    }

    if (gatewayCheck.status === 'failed') {
      const rejected = await subscriptionsRepository.rejectPayment(
        payment.id,
        `Paiement ${gatewayCheck.rawStatus} sur SasPay`
      );
      return {
        status: 'rejected',
        activated: false,
        payment: rejected,
        gatewayStatus: gatewayCheck.rawStatus,
        message: 'Le paiement a échoué ou a été annulé sur SasPay.',
      };
    }

    return {
      status: 'pending',
      activated: false,
      payment,
      gatewayStatus: gatewayCheck.rawStatus,
      message: 'Paiement toujours en cours de confirmation sur SasPay.',
    };
  }

  /**
   * Traite les webhooks entrants SasPay (POST /api/v1/subscriptions/webhooks/saspay)
   * - Vérifie la signature HMAC-SHA256 + protection anti-rejeu <= 300s
   * - Revérifie côté serveur via GET /payments/{id}/verify/ avant activation (recommandation docs.saspay.me)
   */
  async handleSaspayWebhook(params: {
    rawBody: string;
    signatureHeader?: string;
    timestampHeader?: string;
    payload: any;
  }) {
    // 1. Vérification de signature cryptographique si SASPAY_WEBHOOK_SECRET est configuré (obligatoire en production)
    if (env.SASPAY_WEBHOOK_SECRET || env.NODE_ENV === 'production') {
      const check = verifySaspayWebhookSignature({
        rawBody: params.rawBody,
        signatureHeader: params.signatureHeader,
        timestampHeader: params.timestampHeader,
      });

      if (!check.valid) {
        logger.warn(`[SasPay Webhook] Signature rejetée : ${check.reason}`);
        throw new UnauthorizedError(check.reason || 'Signature webhook SasPay invalide');
      }
    }

    const payload = params.payload || {};
    const event = String(payload.event || payload.type || '').trim().toLowerCase();
    const data = payload.data || payload;

    // 2. Événement de test depuis le tableau de bord SasPay
    if (event === 'webhook.test') {
      logger.info('[SasPay Webhook] Événement webhook.test reçu et acquitté avec succès.');
      return { received: true, event: 'webhook.test', processed: true };
    }

    // 3. Extraction des identifiants possibles (session_id, transaction id, référence SUB-...)
    const candidateIds: string[] = [];
    if (data?.checkout_session_id) candidateIds.push(String(data.checkout_session_id));
    if (data?.session_id) candidateIds.push(String(data.session_id));
    if (data?.id) candidateIds.push(String(data.id));
    if (data?.reference) candidateIds.push(String(data.reference));

    // Extraire aussi une référence SUB-... depuis le champ description
    const desc = String(data?.description || '');
    const subRefMatch = desc.match(/SUB-[A-Z0-9-]+/i);
    if (subRefMatch) {
      candidateIds.push(subRefMatch[0]);
    }

    let payment = null;
    for (const candidate of candidateIds) {
      payment = await subscriptionsRepository.findPaymentByReferenceOrTransaction(candidate);
      if (payment) break;
    }

    if (!payment) {
      logger.warn('[SasPay Webhook] Aucun paiement d’abonnement correspondant trouvé', {
        event,
        candidateIds,
      });
      return { received: true, event, processed: false, reason: 'payment_not_found' };
    }

    // 4. Déterminer le statut métier de l'événement
    const statusFromEvent =
      event === 'transaction.success'
        ? 'success'
        : event === 'transaction.failed' || event === 'transaction.cancelled'
        ? 'failed'
        : mapSaspayStatus(data?.status);

    // 5. Idempotence : déjà validé
    if (payment.status === 'validated') {
      return {
        received: true,
        event,
        processed: true,
        alreadyValidated: true,
        paymentReference: payment.paymentReference,
      };
    }

    if (statusFromEvent === 'success') {
      // Bonne pratique docs.saspay.me : toujours revérifier l'état auprès de l'API SasPay avant d'activer le service
      const verifyTargetId = data?.id ? String(data.id) : payment.transactionNumber;
      if (saspayClient.isConfigured() && verifyTargetId) {
        const verified = await saspayClient.verifyPayment(verifyTargetId);
        if (verified.status !== 'success') {
          logger.warn(
            `[SasPay Webhook] Discordance entre webhook (${event}) et vérification serveur (${verified.rawStatus}) pour ${payment.paymentReference}`
          );
          return {
            received: true,
            event,
            processed: false,
            reason: 'server_verification_not_confirmed',
            gatewayStatus: verified.rawStatus,
          };
        }
      }

      // Mettre à jour le transactionNumber avec l'ID final de transaction si différent
      if (data?.id && String(data.id) !== payment.transactionNumber) {
        await subscriptionsRepository.updatePaymentTransactionNumber(payment.id, String(data.id));
        payment.transactionNumber = String(data.id);
      }

      await this.activateSubscriptionPayment(
        payment,
        'saspay_webhook',
        'la passerelle SasPay (confirmation webhook)'
      );

      return {
        received: true,
        event,
        processed: true,
        activated: true,
        paymentReference: payment.paymentReference,
      };
    }

    if (statusFromEvent === 'failed') {
      if (payment.status === 'pending') {
        await subscriptionsRepository.rejectPayment(
          payment.id,
          `Échec / annulation signalé par SasPay (${event || data?.status || 'FAILED'})`
        );
      }
      return {
        received: true,
        event,
        processed: true,
        activated: false,
        status: 'rejected',
        paymentReference: payment.paymentReference,
      };
    }

    return {
      received: true,
      event,
      processed: false,
      status: 'pending',
      paymentReference: payment.paymentReference,
    };
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
        description: `Offre gratuite de bienvenue (essai de ${STARTER_TRIAL_MONTHS} mois)`,
        priceMonthlyXof: 0,
        ...DEFAULT_PLAN_QUOTAS.starter,
        features: DEFAULT_PLAN_FEATURES.starter,
      });
    }

    const startDate = new Date();
    const endDate = computeStarterTrialEnd(startDate); // Essai gratuit de 3 mois

    await subscriptionsRepository.createSubscription({
      organizationId,
      planId: plan.id,
      startDate,
      endDate,
      status: 'active',
    });

    logger.info(`[Subscription] Abonnement starter gratuit de ${STARTER_TRIAL_MONTHS} mois créé pour l'organisation ${organizationId} (échéance ${endDate.toISOString()})`);
  }
}

