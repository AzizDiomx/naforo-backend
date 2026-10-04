import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { env } from '@/config/env';
import { redis } from '@/config/redis';
import { UnauthorizedError, ForbiddenError } from '../errors/AppError';
import { prisma } from '@/config/database';
import { JwtPayload, AuthUser } from '../types';
import { asyncHandler } from '../helpers/response';

/**
 * Authenticate middleware to enforce JWT validation from HttpOnly cookies or Bearer Header
 */
export const authenticate = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    let token = req.cookies?.accessToken;

    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
      }
    }

    if (!token && req.query?.token) {
      token = req.query.token as string;
    }

    if (!token) {
      throw new UnauthorizedError('Accès non autorisé : Jeton de session manquant.');
    }

    // Check if token is blacklisted in Redis (e.g. after logout)
    const isBlacklisted = await redis.get(`blacklist:${token}`);
    if (isBlacklisted) {
      throw new UnauthorizedError('Accès non autorisé : Session révoquée.');
    }

    try {
      const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
      
      const authUser: AuthUser = {
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role as any,
        organizationId: decoded.organizationId || null,
      };

      req.user = authUser;
      req.organizationId = decoded.organizationId || undefined;

      // Vérification du statut d'abonnement du tenant (Désactivation & Suspension Lecture Seule)
      if (authUser.organizationId && authUser.role !== 'super_admin') {
        const org = await prisma.organization.findUnique({
          where: { id: authUser.organizationId },
          select: { isActive: true },
        });

        if (org && !org.isActive) {
          throw new ForbiddenError(
            "L'accès à votre compte est désactivé car l'abonnement de votre organisation a expiré depuis plus de 5 jours. Veuillez contacter le support pour régulariser votre compte."
          );
        }

        // Vérifier le mode LECTURE SEULE pour les organisations suspendues
        const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
        const isAllowedRoute = 
          req.originalUrl.includes('/subscriptions') ||
          req.originalUrl.includes('/auth/logout');

        if (isMutation && !isAllowedRoute) {
          const sub = await prisma.subscription.findFirst({
            where: { organizationId: authUser.organizationId },
            include: { plan: true },
            orderBy: { endDate: 'desc' },
          });

          if (sub && sub.plan.code !== 'starter') {
            const now = new Date();
            if (sub.status === 'suspended' || now > new Date(sub.endDate)) {
              throw new ForbiddenError(
                "Votre abonnement est suspendu pour défaut de paiement. Votre espace est en mode LECTURE SEULE. Veuillez déclarer votre réabonnement pour effectuer cette action."
              );
            }
          }
        }
      }
      
      next();
    } catch (error) {
      if (error instanceof ForbiddenError) {
        throw error;
      }
      throw new UnauthorizedError('Accès non autorisé : Session ou jeton invalide/expiré.');
    }
  }
);

/**
 * Optional authentication middleware (allows request to pass through without req.user if token is not provided)
 */
export const optionalAuthenticate = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];

    const isBlacklisted = await redis.get(`blacklist:${token}`);
    if (isBlacklisted) {
      return next();
    }

    try {
      const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
      
      const authUser: AuthUser = {
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role as any,
        organizationId: decoded.organizationId || null,
      };

      req.user = authUser;
      req.organizationId = decoded.organizationId || undefined;
    } catch (error) {
      // Fail silently for optional auth
    }
    
    next();
  }
);
