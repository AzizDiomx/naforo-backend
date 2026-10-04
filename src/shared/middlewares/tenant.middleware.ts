import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../errors/AppError';

/**
 * Ensure organization context is set for multi-tenant route execution.
 * Only super_admin can query globally, others must have req.organizationId.
 */
export function requireTenant(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role === 'super_admin') {
    return next();
  }

  if (!req.organizationId) {
    return next(new ForbiddenError('Accès interdit : Contexte d\'organisation manquant.'));
  }

  next();
}
