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

    if (activeSub && activeSub.plan.code !== 'starter') {
      const now = new Date();
      if (activeSub.status === 'suspended' || now > new Date(activeSub.endDate)) {
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
 * Middleware de contrôle strict des fonctionnalités clés selon la formule souscrite.
 * Exemple: requirePlanFeature('sms_whatsapp', 'Relances SMS & WhatsApp')
 */
export function requirePlanFeature(featureCode: string, featureLabel: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.organizationId) return next();
    if (req.user && req.user.role === 'super_admin') return next();

    try {
      let activeSub = await prisma.subscription.findFirst({
        where: { organizationId: req.organizationId },
        include: { plan: true },
        orderBy: { endDate: 'desc' },
      });

      let plan = activeSub?.plan;
      if (!plan) {
        // Fallback vers le plan Starter gratuit
        plan = await prisma.subscriptionPlan.findUnique({ where: { code: 'starter' } }) || undefined;
      }

      if (!plan) {
        throw new ForbiddenError("Aucun forfait d'abonnement trouvé pour cette organisation.");
      }

      // Décodage des fonctionnalités incluses dans le forfait
      let features: string[] = [];
      try {
        features = typeof plan.features === 'string'
          ? JSON.parse(plan.features)
          : (plan.features as string[]) || [];
      } catch {
        features = [];
      }

      const hasFeature = features.includes(featureCode);

      if (!hasFeature) {
        throw new ForbiddenError(
          `La fonctionnalité "${featureLabel}" n'est pas incluse dans votre formule actuelle (${plan.name}). Veuillez surclasser votre abonnement pour débloquer cet outil.`
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
