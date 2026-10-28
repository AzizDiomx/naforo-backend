import { Request, Response, NextFunction } from 'express';
import { prisma } from '@/config/database';
import { ForbiddenError } from '@/shared/errors/AppError';

export async function checkSubscription(req: Request, res: Response, next: NextFunction) {
  // 1. Ignorer les requêtes hors organisation (super_admin global, routes d'auth initiales...)
  if (!req.organizationId) {
    return next();
  }
  if (req.user && req.user.role === 'super_admin') {
    return next();
  }

  // 2. Laisser passer les requêtes GET (Lecture) dans tous les cas
  if (req.method === 'GET') {
    return next();
  }

  // 3. Toujours autoriser les requêtes sur le module d'abonnement
  if (req.originalUrl.includes('/api/v1/subscriptions')) {
    return next();
  }

  try {
    const activeSub = await prisma.subscription.findFirst({
      where: { organizationId: req.organizationId },
      include: { plan: true },
      orderBy: { endDate: 'desc' },
    });

    if (activeSub) {
      const now = new Date();
      const isStarter = activeSub.plan.code === 'starter';
      const isPastEndDate = now > new Date(activeSub.endDate);

      if (isStarter && isPastEndDate) {
        throw new ForbiddenError(
          "PÉRIODE D'ESSAI TERMINÉE : Vos 60 jours d'essai gratuit de l'offre Starter sont arrivés à échéance. Veuillez souscrire à une formule d'abonnement ou contacter les administrateurs pour continuer."
        );
      }

      if (!isStarter && (activeSub.status === 'suspended' || isPastEndDate)) {
        throw new ForbiddenError(
          `Votre abonnement a expiré le ${new Date(activeSub.endDate).toLocaleDateString('fr-FR')}. Votre espace est configuré en lecture seule. Veuillez déclarer un renouvellement d'abonnement pour réactiver les droits d'écriture.`
        );
      }
    }

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Récupère le plan et les fonctionnalités actives d'une organisation
 */
export async function getOrganizationSubscriptionFeatures(organizationId: string) {
  const activeSub = await prisma.subscription.findFirst({
    where: { organizationId, status: 'active' },
    include: { plan: true },
    orderBy: { endDate: 'desc' },
  });

  let plan = activeSub?.plan;
  let org = null;
  if (!plan) {
    org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, plan: true, phone: true, email: true },
    });
    const planCode = org?.plan || 'starter';
    plan = (await prisma.subscriptionPlan.findUnique({ where: { code: planCode } })) || undefined;
  } else {
    org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, plan: true, phone: true, email: true },
    });
  }

  let features: string[] = [];
  if (plan?.features) {
    try {
      features = typeof plan.features === 'string'
        ? JSON.parse(plan.features)
        : (plan.features as string[]) || [];
    } catch {
      features = [];
    }
  }

  const planCode = (plan?.code || org?.plan || 'starter').toLowerCase();
  const hasChat = features.includes('chat_encrypted') || planCode.includes('pro') || planCode.includes('expert');

  return {
    organizationId,
    organizationName: org?.name || 'Organisation',
    planCode,
    planName: plan?.name || 'Starter',
    features,
    hasChat,
  };
}

/**
 * Middleware de contrôle strict des fonctionnalités clés selon la formule souscrite.
 * Exemple: requirePlanFeature('chat_encrypted', 'Messagerie instantanée')
 */
export function requirePlanFeature(featureCode: string, featureLabel: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    let orgId = req.organizationId;
    if (!orgId && req.user?.userId) {
      const profile = await prisma.tenantProfile.findFirst({
        where: { userId: req.user.userId },
        select: { organizationId: true },
      });
      if (profile?.organizationId) {
        orgId = profile.organizationId;
        req.organizationId = orgId;
      }
    }

    if (!orgId) return next();
    if (req.user && req.user.role === 'super_admin') return next();

    try {
      const { planName, planCode, features, hasChat } = await getOrganizationSubscriptionFeatures(orgId);

      const hasFeature = featureCode === 'chat_encrypted' ? hasChat : features.includes(featureCode);

      if (!hasFeature) {
        throw new ForbiddenError(
          `La fonctionnalité "${featureLabel}" n'est pas incluse dans votre formule actuelle (${planName}). Veuillez surclasser votre abonnement pour débloquer cet outil.`
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
