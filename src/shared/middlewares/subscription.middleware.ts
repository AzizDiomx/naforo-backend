import { Request, Response, NextFunction } from 'express';
import { prisma } from '@/config/database';
import { ForbiddenError } from '@/shared/errors/AppError';
import { getOrganizationPlanContext, planIncludesFeature } from '@/shared/helpers/plan-policy';

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
      const isExpired = now > new Date(activeSub.endDate);

      if (isStarter && isExpired) {
        const err = new ForbiddenError(
          "Votre période d'essai gratuit du forfait Starter est arrivée à son terme. Votre espace est configuré en lecture seule. Veuillez souscrire à une formule Pro ou Expert pour réactiver vos accès d'écriture."
        );
        (err as any).code = 'TRIAL_EXPIRED';
        (err as any).errors = {
          trialExpired: true,
          planCode: 'starter',
          planName: 'Starter',
          expiredAt: activeSub.endDate,
        };
        throw err;
      }

      if (!isStarter && (activeSub.status === 'suspended' || isExpired)) {
        const err = new ForbiddenError(
          `Votre abonnement a expiré le ${new Date(activeSub.endDate).toLocaleDateString('fr-FR')}. Votre espace est configuré en lecture seule. Veuillez déclarer un renouvellement d'abonnement pour réactiver les droits d'écriture.`
        );
        (err as any).code = 'SUBSCRIPTION_EXPIRED';
        (err as any).errors = {
          subscriptionExpired: true,
          planCode: activeSub.plan.code,
          planName: activeSub.plan.name,
          expiredAt: activeSub.endDate,
        };
        throw err;
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
  const ctx = await getOrganizationPlanContext(organizationId);
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, plan: true, phone: true, email: true },
  });

  const hasChat = planIncludesFeature(ctx.planCode, ctx.features, 'chat_encrypted');

  return {
    organizationId,
    organizationName: org?.name || 'Organisation',
    planCode: ctx.planCode,
    planName: ctx.planName,
    features: ctx.features,
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
      const { planName, planCode, features } = await getOrganizationSubscriptionFeatures(orgId);

      const hasFeature = planIncludesFeature(planCode, features, featureCode);

      if (!hasFeature) {
        const err = new ForbiddenError(
          `La fonctionnalité "${featureLabel}" n'est pas incluse dans votre formule actuelle (${planName}). Veuillez surclasser votre abonnement pour débloquer cet outil.`
        );
        (err as any).code = 'FEATURE_NOT_INCLUDED';
        (err as any).errors = {
          featureRequired: featureCode,
          featureLabel,
          currentPlanCode: planCode,
          currentPlanName: planName,
        };
        throw err;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
