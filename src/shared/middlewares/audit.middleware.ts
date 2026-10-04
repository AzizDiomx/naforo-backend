import { Request, Response, NextFunction } from 'express';
import { prisma } from '@/config/database';
import { logger } from '@/config/logger';

export function auditLog(action: string, entityType?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const originalJson = res.json;

    // Hook into response json to capture audit data after successful execution
    res.json = function (body: any): Response {
      // Restore default res.json
      res.json = originalJson;

      // Only audit log on successful status codes
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Trigger audit logging asynchronously without blocking client response
        prisma.auditLog
          .create({
            data: {
              organizationId: req.organizationId || null,
              userId: req.user?.userId || null,
              action,
              entityType: entityType || null,
              entityId: body?.data?.id || req.params?.id || null,
              oldData: req.method === 'PUT' || req.method === 'PATCH' ? req.body : undefined,
              newData: body?.data ? body.data : undefined,
              ipAddress: req.ip,
              userAgent: req.headers['user-agent'] || null,
            },
          })
          .catch((err) => {
            logger.error('Failed to write audit log to database', {
              error: err.message,
              action,
            });
          });
      }

      return res.json(body);
    };

    next();
  };
}

/**
 * Record custom security audit log (e.g. failed login attempts, admin actions)
 */
export async function recordSecurityAuditLog(data: {
  action: string;
  userId?: string | null;
  organizationId?: string | null;
  entityType?: string;
  entityId?: string;
  details?: any;
  ipAddress?: string;
  userAgent?: string;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: data.organizationId || null,
        userId: data.userId || null,
        action: data.action,
        entityType: data.entityType || 'SECURITY',
        entityId: data.entityId || null,
        newData: data.details || undefined,
        ipAddress: data.ipAddress || null,
        userAgent: data.userAgent || null,
      },
    });
  } catch (err: any) {
    logger.error(`Failed to write security audit log [${data.action}]`, { error: err.message });
  }
}
