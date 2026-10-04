import { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '../errors/AppError';
import { UserRole } from '../types';

/**
 * Enforce RBAC by specifying permitted roles
 */
export function authorize(...allowedRoles: (UserRole | string)[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError('Accès non autorisé : Non authentifié.'));
    }

    const { role } = req.user;

    // super_admin bypasses all RBAC constraints
    if (role === 'super_admin') {
      return next();
    }

    // Owner and admin are interchangeable role aliases for rental account managers
    if (
      (role === 'owner' && allowedRoles.includes('admin')) ||
      (role === 'admin' && allowedRoles.includes('owner'))
    ) {
      return next();
    }

    if (!allowedRoles.includes(role)) {
      return next(new ForbiddenError('Accès interdit : Permissions insuffisantes.'));
    }

    next();
  };
}

/**
 * Custom handler to verify if the requesting user owns the resource or has manager/admin/owner access
 */
export function authorizeOwnership(
  getResourceUserId: (req: Request) => string | Promise<string>
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError('Accès non autorisé : Non authentifié.'));
    }

    const { userId, role } = req.user;

    // Admin, owner, manager and super_admin bypass ownership check
    if (['super_admin', 'admin', 'manager', 'owner'].includes(role)) {
      return next();
    }

    try {
      const resourceUserId = await getResourceUserId(req);
      if (resourceUserId !== userId) {
        return next(new ForbiddenError('Accès interdit : Vous n\'êtes pas propriétaire de cette ressource.'));
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
